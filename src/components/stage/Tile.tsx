import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Eye, Volume2, Zap } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { AnnotationLayer } from '@/components/annotate/AnnotationLayer';
import { cn } from '@/lib/cn';
import { useRoom } from '@/stores/room';
import { exitFullscreen, watchPeer } from '@/features/voice/actions';
import { TileBar } from './TileBar';
import type { StageEntry } from './useStageEntries';

interface TileProps {
  entry: StageEntry;
  focused: boolean;
  /** Tela cheia de verdade: cobre a janela inteira, por cima de tudo. */
  fullscreen?: boolean;
  /** Card pequeno (fita de participantes) — avatar e texto menores, cabem em h-28. */
  compact?: boolean;
  /** No filmstrip o tile inteiro vira botão de destacar. */
  clickable?: boolean;
  onClick?(): void;
}

/**
 * Um participante no palco: o vídeo dele, ou o avatar quando não há vídeo.
 *
 * O estado que importa aqui é o do meio: a pessoa anunciou que está
 * transmitindo, mas eu ainda não pedi para assistir. Nesse caso mostramos a
 * miniatura estática e um botão — sem gastar a banda dela nem a minha até eu
 * realmente querer ver.
 */
export function Tile({ entry, focused, fullscreen, compact, clickable, onClick }: TileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Referência estável: sem isto, cada render de Tile cria uma função nova, o
  // useEffect de AnnotationLayer (que depende dela) reexecuta a cada bump de
  // tick, e o cleanup dele desliga o modo caneta assim que ele é ligado — a
  // caneta "não pega" porque se autodesativa no instante seguinte.
  const getVideo = useCallback(() => videoRef.current, []);
  const getRoot = useCallback(() => rootRef.current, []);
  const watching = useRoom((s) => s.watching.has(entry.id));
  const preview = useRoom((s) => s.previews.get(entry.id));
  const [needsGesture, setNeedsGesture] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const pending = !entry.isLocal && entry.intendsScreen && !entry.sharing && !watching;
  const showVideo = entry.sharing && Boolean(entry.stream);

  /**
   * Callback ref, e não um useEffect, de propósito. Entrar/sair da tela cheia
   * troca a árvore de DOM (portal ↔ inline): o React descarta o <video> velho
   * e cria um novo, mas o componente NÃO remonta — um efeito com deps
   * [stream, ...] não roda de novo, e o vídeo novo nascia sem srcObject.
   * Era exatamente o bug da "tela cheia preta" que só voltava no modo grade
   * (onde a posição na árvore muda e o componente remonta de verdade).
   * O callback ref roda sempre que o elemento em si troca — é o gancho certo.
   */
  const attachVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (!node || !showVideo || !entry.stream) return;
      if (node.srcObject !== entry.stream) {
        node.srcObject = entry.stream;
        node.muted = entry.isLocal; // nunca tocar o próprio áudio: vira eco
        node.play().catch(() => setNeedsGesture(true));
      }
    },
    [showVideo, entry.stream, entry.isLocal],
  );

  // O caso complementar: o stream muda (ou some) com o MESMO elemento no lugar.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!showVideo || !entry.stream) {
      video.srcObject = null;
      return;
    }
    if (video.srcObject === entry.stream) return;

    video.srcObject = entry.stream;
    video.muted = entry.isLocal;
    video.play().catch(() => setNeedsGesture(true));
  }, [showVideo, entry.stream, entry.isLocal]);

  // Quem parou de transmitir enquanto alguém olhava em tela cheia não deixa
  // ninguém preso numa tela cheia preta e vazia.
  useEffect(() => {
    if (fullscreen && !showVideo) exitFullscreen();
  }, [fullscreen, showVideo]);

  // Como no YouTube: os controles aparecem ao mexer o mouse e somem sozinhos
  // depois de alguns segundos parado — só faz sentido em tela cheia, onde não
  // há "fora do tile" pra tirar o mouse de cima e esconder pelo hover normal.
  useEffect(() => {
    if (!fullscreen) { setControlsVisible(true); return; }
    const node = rootRef.current;
    if (!node) return;

    let timer: number;
    const reveal = () => {
      setControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 3000);
    };
    reveal();
    node.addEventListener('mousemove', reveal);
    return () => {
      node.removeEventListener('mousemove', reveal);
      window.clearTimeout(timer);
    };
  }, [fullscreen]);

  const tile = (
    <motion.div
      ref={rootRef}
      // FLIP de layout + reparenting (portal da tela cheia) não convivem: o
      // Motion mede a posição na árvore antiga e aplica um transform que não
      // vale na nova. Em tela cheia a animação de layout fica desligada.
      layout={!fullscreen}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      onClick={clickable ? onClick : undefined}
      className={cn(
        // `size-full` importa: dentro de célula de grid ele é redundante, mas
        // na fita de participantes (flex) o tile colapsava para a altura do
        // conteúdo — vídeo espremido no topo e um vão sobrando embaixo.
        'group relative flex min-h-0 size-full items-center justify-center overflow-hidden',
        fullscreen
          ? 'fixed inset-0 z-70 rounded-none bg-black'
          : 'rounded-[var(--radius-lg)] bg-tile ring-1 ring-line transition-shadow duration-(--duration-med)',
        entry.speaking && !fullscreen && 'ring-2 ring-green',
        focused && !fullscreen && 'ring-2 ring-accent',
        clickable && 'cursor-pointer hover:ring-accent',
      )}
    >
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        className={cn('size-full object-contain', !showVideo && 'hidden')}
      />

      {!showVideo && !pending && (
        <div className={cn('flex flex-col items-center text-center', compact ? 'gap-1 p-2' : 'gap-2 p-4')}>
          <Avatar user={entry.user} size={compact ? 'md' : 'lg'} speaking={entry.speaking} />
          <p className={cn('text-dim', compact ? 'text-[11px] leading-tight' : 'text-[13px]')}>{entry.status}</p>
        </div>
      )}

      {pending && <WatchPrompt preview={preview} onWatch={() => watchPeer(entry.id)} />}

      {showVideo && (
        <AnnotationLayer targetId={entry.id} video={getVideo} />
      )}

      {(entry.sharing || entry.intendsScreen) && (
        <span className="pointer-events-none absolute top-2.5 left-2.5 flex items-center gap-1
                         rounded-full bg-red px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
          <Zap size={10} />
          {entry.isLocal ? 'TRANSMITINDO' : 'AO VIVO'}
        </span>
      )}

      {needsGesture && (
        <Button
          variant="primary"
          className="absolute inset-x-0 bottom-14 mx-auto w-fit"
          onClick={(e) => {
            e.stopPropagation();
            void videoRef.current?.play();
            setNeedsGesture(false);
          }}
        >
          <Volume2 size={16} /> Clique para ativar o som
        </Button>
      )}

      <TileBar
        entry={entry}
        focused={focused}
        fullscreen={fullscreen}
        showVideo={showVideo}
        video={getVideo}
        root={getRoot}
        controlsVisible={fullscreen ? controlsVisible : undefined}
      />
    </motion.div>
  );

  // Fora daqui (`position: fixed` sozinho não basta): um ancestral com vidro
  // (backdrop-filter) cria o próprio contexto de empilhamento e prende o
  // z-index lá dentro — o painel de membros, por exemplo, é outra árvore de
  // vidro e pintava por cima mesmo com z-index maior. Um portal direto no
  // `body` bota o tile no mesmo nível dos modais (Radix também usa portal) e
  // resolve pra qualquer ancestral, não só o painel de membros.
  return fullscreen ? createPortal(tile, document.body) : tile;
}

function WatchPrompt({ preview, onWatch }: { preview?: string; onWatch(): void }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      {preview && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-45 blur-[2px]"
          style={{ backgroundImage: `url('${preview}')` }}
        />
      )}
      <Button
        variant="primary"
        className="relative"
        onClick={(e) => {
          e.stopPropagation();
          onWatch();
        }}
      >
        <Eye size={16} /> Assistir transmissão
      </Button>
    </div>
  );
}
