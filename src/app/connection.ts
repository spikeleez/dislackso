import { connectSocket } from '@/lib/socket/client';
import { ask } from '@/lib/socket/client';
import { annot } from '@/lib/annot/engine';
import { feedback } from '@/lib/feedback';
import { isDesktop } from '@/lib/platform';
import { voice } from '@/lib/rtc/engine';
import { useAnnouncements } from '@/stores/announcements';
import { useGuilds } from '@/stores/guilds';
import { useMessages, messageKey } from '@/stores/messages';
import { useRoom } from '@/stores/room';
import { savedCredentials, useSession } from '@/stores/session';
import { settings } from '@/stores/settings';
import { toast } from '@/stores/toasts';
import { useUpdateAnnounce } from '@/stores/updateAnnounce';
import type { SessionPayload } from '@/types/api';
import { joinVoice, leaveVoice } from '@/features/voice/actions';

/** Se o servidor não responder nisso, deixamos o usuário entrar na mão. */
const BOOT_TIMEOUT_MS = 8000;

/** `App` chama isto num `useEffect` sem cleanup; em StrictMode o efeito roda duas vezes. */
let started = false;

/**
 * Liga o app ao servidor e mantém os stores em dia.
 *
 * Este é o único lugar do app que escuta eventos empurrados pelo servidor.
 * Toda a interface lê dos stores; nenhum componente fala com o socket
 * diretamente — é o que impede o retorno do emaranhado de listeners espalhados
 * que existia no 3.x.
 *
 * Roda uma vez só pra vida inteira do app: chamar de novo registraria os
 * mesmos listeners duas vezes no socket singleton, e cada evento do servidor
 * (mensagem, aviso, entrada na sala) apareceria repetido.
 */
export function startConnection(): void {
  if (started) return;
  started = true;

  const socket = connectSocket();
  const session = useSession.getState();

  socket.on('connect', () => {
    useSession.getState().setConnected(true);
    const saved = savedCredentials();
    if (!saved) return useSession.getState().setPhase('gate');

    ask('hello', saved)
      .then(adoptSession)
      .catch((err: Error) => {
        useSession.getState().setPhase('gate');
        if (err.message !== 'auth_required') toast(`Falha ao entrar: ${err.message}`);
      });
  });

  socket.on('disconnect', () => {
    useSession.getState().setConnected(false);
    const room = useRoom.getState().room;
    if (room) {
      useSession.getState().setRejoin(room);
      void leaveVoice({ silent: true });
    }
  });

  /* ------------------------------------------------------- servidores --- */

  socket.on('guild:update', (guild) => {
    useGuilds.getState().upsert(guild);
    const room = useRoom.getState().room;
    if (room?.guildId === guild.id && !guild.channels.some((c) => c.id === room.channelId)) {
      void leaveVoice({ silent: true });
    }
  });

  socket.on('guild:deleted', ({ guildId }) => {
    useGuilds.getState().remove(guildId);
    if (useRoom.getState().room?.guildId === guildId) void leaveVoice({ silent: true });
    toast('Um servidor foi excluído pelo dono.');
  });

  socket.on('guild:kicked', ({ guildId }) => {
    const guild = useGuilds.getState().guilds.find((g) => g.id === guildId);
    if (useRoom.getState().room?.guildId === guildId) void leaveVoice({ silent: true });
    useGuilds.getState().remove(guildId);
    toast(guild ? `Você foi removido de ${guild.name}.` : 'Você foi removido de um servidor.');
  });

  // O dono me mandou para outra sala. O join normal cuida de sair da atual.
  socket.on('voice:moved', ({ guildId, channelId }) => {
    void joinVoice(guildId, channelId).then(() => toast('O dono do servidor te moveu de sala.'));
  });

  socket.on('guild:online', ({ guildId, online }) => useGuilds.getState().setOnline(guildId, online));

  socket.on('presence:update', ({ guildId, presence }) =>
    useGuilds.getState().setPresence(guildId, presence),
  );

  socket.on('user:update', (user) => {
    useGuilds.getState().refreshMember(user);
    for (const peer of voice.mesh.peers.values()) {
      if (peer.user.id === user.id) peer.user = user;
    }
    if (useSession.getState().me?.id === user.id) useSession.getState().setMe(user);
    useRoom.getState().bump();
  });

  /* ------------------------------------------------------------- voz --- */

  socket.on('voice:peerJoined', (info) => {
    if (!useRoom.getState().room) return;
    voice.mesh.add(info);
    toast(`${info.user.name} entrou na sala.`);
    feedback('join');
  });

  socket.on('voice:peerLeft', ({ sid }) => {
    const peer = voice.mesh.peers.get(sid);
    voice.mesh.remove(sid);
    useRoom.getState().unwatch(sid);
    if (peer) toast(`${peer.user.name} saiu da sala.`);
    feedback('leave');
  });

  socket.on('voice:state', ({ sid, state }) => {
    voice.mesh.setPeerState(sid, state);
    announceSharing(sid, state.screen);
    // Se a pessoa parou de compartilhar, esqueço que eu estava assistindo —
    // senão, quando ela compartilhar de novo, o app acha que já devia estar
    // recebendo o vídeo e nunca manda o pedido de novo.
    if (!state.screen) useRoom.getState().unwatch(sid);
  });

  socket.on('rtc:signal', ({ from, data }) => voice.mesh.handleSignal(from, data));

  socket.on('screen:preview', ({ from, dataUrl }) => useRoom.getState().setPreview(from, dataUrl));

  /* -------------------------------------------------------- mensagens --- */

  socket.on('message:new', ({ guildId, channelId, message }) => {
    useMessages.getState().append(guildId, channelId, message);
    const { activeGuildId, activeTextChannelId } = useGuilds.getState();
    const open = activeGuildId === guildId && activeTextChannelId === channelId;
    if (!open && message.userId !== useSession.getState().me?.id) feedback('message');
  });

  /* ---------------------------------------------------------- avisos --- */

  socket.on('admin:message', (payload) => useAnnouncements.getState().enqueue(payload));

  // Empurrado quando uma release nova termina de publicar os instaladores
  // (ver .github/workflows/build-release.yml). Só faz sentido no app
  // instalado — na web a próxima visita já carrega a versão nova sozinha.
  socket.on('app:update', ({ version }) => {
    if (!isDesktop()) return;
    feedback('announce');
    toast(`Nova versão ${version} disponível — clique para atualizar.`, 120000, () => {
      useUpdateAnnounce.getState().show();
    });
  });

  /* --------------------------------------------------------- anotação --- */

  socket.on('annot:draw', (patch) => annot.applyRemote(patch));
  socket.on('annot:clear', ({ target }) => annot.clear(target, false));

  annot.start();

  // Se a conexão inicial travar (servidor fora do ar, rede lenta), não deixa
  // o usuário preso atrás do loading para sempre.
  setTimeout(() => {
    if (useSession.getState().phase === 'booting') session.setPhase('gate');
  }, BOOT_TIMEOUT_MS);
}

/** Abre a sessão para valer, depois de hello / login / registro / claim. */
export function adoptSession(payload: SessionPayload): void {
  const session = useSession.getState();
  session.adopt(payload);
  useGuilds.getState().setGuilds(payload.guilds);

  voice.configure(payload.sid, payload.iceServers);
  voice.setQuality(settings().quality);
  voice.setContentHint(settings().contentHint);

  const rejoin = session.rejoin;
  if (rejoin) {
    session.setRejoin(null);
    void joinVoice(rejoin.guildId, rejoin.channelId).then(() => toast('Reconectado à sala.'));
  }
}

/** Avisa (uma vez só) quando alguém começa ou para de transmitir. */
function announceSharing(sid: string, sharing: boolean): void {
  const room = useRoom.getState();
  const seen = room.sharingSeen.has(sid);
  if (sharing === seen) return;

  const peer = voice.mesh.peers.get(sid);
  room.markSharing(sid, sharing);

  if (sharing) {
    if (settings().autoFocus && !room.focusId) room.focus(sid);
    if (peer) toast(`${peer.user.name} começou a transmitir.`);
    feedback('screenstart');
  } else {
    if (room.focusId === sid) room.focus(null);
    if (peer) toast(`${peer.user.name} parou de transmitir.`);
    feedback('screenstop');
  }
}

/** Chave de canal reexportada por conveniência de quem escuta mensagens. */
export { messageKey };
