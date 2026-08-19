import { Emitter } from '@/lib/emitter';
import type { VoiceEvents } from './events';
import { feedback } from '@/lib/feedback';
import { tell } from '@/lib/socket/client';
import { settings, useSettings } from '@/stores/settings';
import { MicGraph } from './mic';
import { PeerMesh } from './mesh';
import type { Peer } from './peer';
import { QualityControl } from './quality';
import { ScreenSharing } from './sharing';
import { buildReport } from './stats';

/**
 * O motor de mídia da sala de voz.
 *
 * Compõe peças independentes — `mic`, `mesh`, `screen`, `quality` —,
 * expostas direto para quem usa em vez de escondidas atrás de métodos que só
 * repassam chamada. O que fica aqui é o que atravessa todas elas: entrar e
 * sair da sala, e o estado consolidado que o resto da sala precisa ver.
 *
 * Vive fora do React de propósito: amarrar WebRTC ao ciclo de render só
 * produziria reconexões a cada re-render. A interface se inscreve nos
 * eventos daqui.
 */
export class VoiceEngine extends Emitter<VoiceEvents> {
  private sid = '';
  private iceServers: RTCIceServer[] = [];
  private inRoom = false;

  /** Mudo completo: não fala nem ouve. Quem lê o áudio dos outros (`PeerAudio`) confere isto. */
  deafened = false;

  readonly quality = new QualityControl({
    onApply: (preset) => {
      this.mesh.retuneAll();
      this.screen.applyQuality(preset);
      this.emit('localchange', undefined);
    },
    onDowngrade: (message, key) => {
      this.emit('notice', message);
      this.emit('qualitydowngraded', key);
    },
  });

  readonly mic = new MicGraph({
    onLevel: (level) => this.emit('level', level),
    onSpeakingChange: () => this.announce(),
    onToggled: () => this.announce(),
  });

  readonly mesh = new PeerMesh({
    sid: () => this.sid,
    iceServers: () => this.iceServers,
    quality: () => this.quality.preset,
    localScreen: () => this.screen.stream,
    localMic: () => this.mic.stream,
    onPeersChange: () => this.emit('peerschange', undefined),
    onPeerChange: (peer) => this.emit('peerchange', peer),
    onNotice: (message) => this.emit('notice', message),
  });

  readonly screen = new ScreenSharing({
    mesh: this.mesh,
    quality: () => this.quality.preset,
    contentHint: () => this.quality.contentHint,
    onNotice: (message) => this.emit('notice', message),
    onChange: () => this.emit('localchange', undefined),
    onStart: () => {
      this.announce();
      this.emit('screenstart', undefined);
    },
    onStop: () => {
      this.announce();
      this.emit('screenstop', undefined);
    },
    onCongested: () => this.quality.downgrade(),
  });

  /** O meu id de socket nesta sessão — é assim que os outros me identificam. */
  get mySid(): string {
    return this.sid;
  }

  configure(sid: string, iceServers: RTCIceServer[]): void {
    this.sid = sid;
    this.iceServers = iceServers;
  }

  /** Conta ao servidor o meu estado e avisa a interface local. */
  private announce(): void {
    this.publishState();
    this.emit('localchange', undefined);
  }

  setQuality(key: string): void {
    this.quality.set(key);
  }

  setContentHint(hint: string): void {
    this.quality.setContentHint(hint);
    this.screen.applyContentHint(hint);
    this.emit('localchange', undefined);
  }

  /* ------------------------------------------------------- microfone --- */

  /**
   * Alterna o microfone. Fica aqui, e não em `mic`, por causa do som de aviso
   * e da persistência: mudo é uma escolha que sobrevive à chamada (e funciona
   * até fora dela) — a próxima call começa exatamente como esta terminou.
   */
  toggleMic(): boolean {
    const prefs = useSettings.getState();

    if (!this.inRoom) {
      // Fora de sala não há faixa nenhuma: o botão só troca a intenção salva.
      const open = prefs.micMuted; // estava mudo → vai abrir
      prefs.set('micMuted', !open);
      if (open) {
        this.deafened = false;
        prefs.set('soundOff', false); // abrir o mic sai do ensurdecido sozinho
      }
      feedback(open ? 'unmute' : 'mute');
      this.emit('localchange', undefined);
      return open;
    }

    const wasMuted = !this.mic.enabled;
    const next = this.mic.toggle();
    if (next === null) {
      this.emit('notice', 'Nenhum microfone disponível.');
      return false;
    }
    prefs.set('micMuted', !next);
    if (next && wasMuted) {
      this.deafened = false; // abrir o mic sai do ensurdecido sozinho
      prefs.set('soundOff', false);
    }
    feedback(next ? 'unmute' : 'mute');
    return next;
  }

  /** Ensurdece: para de ouvir todo mundo e muta o próprio microfone junto. Persiste. */
  toggleDeafen(): boolean {
    const prefs = useSettings.getState();
    this.deafened = !this.deafened;
    prefs.set('soundOff', this.deafened);
    if (this.deafened) {
      prefs.set('micMuted', true);
      if (this.mic.enabled) {
        this.mic.enabled = false;
        this.mic.sync();
      }
    }
    feedback(this.deafened ? 'deafen' : 'undeafen');
    this.announce();
    return this.deafened;
  }

  /** Troca o microfone em uso sem derrubar as conexões. */
  async setMicDevice(): Promise<void> {
    if (!this.inRoom) return;
    try {
      const track = await this.mic.open();
      this.mic.sync();
      await this.mesh.swapMicEverywhere(track);
      this.announce();
    } catch (err) {
      this.emit('notice', `Não consegui abrir esse microfone: ${(err as Error).message}`);
    }
  }

  /* ------------------------------------------------------------ sala --- */

  async start(): Promise<void> {
    this.inRoom = true;
    // Entra como estava: mudo e ensurdecido persistem entre chamadas (os
    // botões ficam fixos no cartão da conta e valem fora de sala). Quem saiu
    // pra falar entra falando; quem se mutou entra mudo — em qualquer call.
    const wanted = settings();
    this.deafened = wanted.soundOff;
    if (!this.mic.stream) {
      try {
        await this.mic.open();
        this.mic.enabled = !wanted.micMuted && !wanted.soundOff;
        this.mic.sync();
      } catch (err) {
        console.warn('[rtc] sem microfone:', (err as Error).message);
        this.emit('notice', 'Microfone indisponível — você ainda pode ouvir e compartilhar tela.');
      }
    }
    this.publishState();
  }

  stop(): void {
    this.inRoom = false;
    // `deafened` NÃO é zerado aqui de propósito: é preferência, não estado da sala.
    this.screen.dispose();
    this.mesh.close();
    this.mic.close();
    this.emit('localchange', undefined);
    this.emit('peerschange', undefined);
  }

  /* ------------------------------------------------- assistir a tela --- */

  /** Pede a quem transmite para começar a me mandar o vídeo de verdade. */
  watch(sid: string): void {
    this.mesh.peers.get(sid)?.send({ watch: true });
  }

  /** Para de assistir — a pessoa deixa de gastar banda me mandando este vídeo. */
  unwatch(sid: string): void {
    this.mesh.peers.get(sid)?.send({ unwatch: true });
  }

  /* ---------------------------------------------------------- estado --- */

  publishState(): void {
    if (!this.inRoom) return;
    tell('voice:state', {
      mic: this.mic.isOpen(),
      screen: this.screen.active,
      speaking: this.mic.speaking,
      annot: settings().annotAllow,
      streams: {
        mic: this.mic.stream?.id ?? null,
        screen: this.screen.stream?.id ?? null,
      },
    });
  }

  report(): Promise<string> {
    return buildReport({
      quality: this.quality.preset,
      contentHint: this.quality.contentHint,
      sharing: this.screen.active,
      peers: [...this.mesh.peers.values()],
    });
  }
}

/** Uma instância só para o app inteiro. */
export const voice = new VoiceEngine();
