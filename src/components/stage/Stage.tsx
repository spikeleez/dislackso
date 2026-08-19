import { Monitor, Users } from 'lucide-react';
import { Glass } from '@/components/ui/Glass';
import { IconButton } from '@/components/ui/Button';
import { Tip } from '@/components/ui/Tooltip';
import { TextChannel } from '@/components/chat/TextChannel';
import { useGuilds } from '@/stores/guilds';
import { useRoom } from '@/stores/room';
import { useSession } from '@/stores/session';
import { voice } from '@/lib/rtc/engine';
import { PeerAudio } from './PeerAudio';
import { ShareHud } from './ShareHud';
import { VoiceStage } from './VoiceStage';

interface StageProps {
  membersOpen: boolean;
  onToggleMembers(): void;
}

/**
 * A coluna principal.
 *
 * Mostra uma de três coisas: o canal de texto aberto, a sala de voz, ou o
 * estado vazio. Um canal de texto aberto tem precedência sobre a sala — sem
 * sair dela: o áudio continua, e clicar na sala de novo volta para o vídeo.
 */
export function Stage({ membersOpen, onToggleMembers }: StageProps) {
  const guilds = useGuilds((s) => s.guilds);
  const activeGuildId = useGuilds((s) => s.activeGuildId);
  const activeTextChannelId = useGuilds((s) => s.activeTextChannelId);
  const room = useRoom((s) => s.room);
  useRoom((s) => s.tick);

  const guild = guilds.find((g) => g.id === activeGuildId) ?? null;
  const textChannel = guild?.channels.find((c) => c.id === activeTextChannelId) ?? null;
  const roomGuild = guilds.find((g) => g.id === room?.guildId) ?? null;
  const roomChannel = roomGuild?.channels.find((c) => c.id === room?.channelId) ?? null;

  const title = textChannel
    ? `# ${textChannel.name}`
    : roomChannel
      ? `${roomGuild?.name} › ${roomChannel.name}`
      : (guild?.name ?? 'Nenhuma sala');

  return (
    <main className="relative flex min-w-0 flex-1 flex-col gap-1.5">
      {/*
        AQUI, e não dentro de VoiceStage: abrir um canal de texto por cima da
        sala desmonta o VoiceStage inteiro — e desmontar o PeerAudio remove os
        <audio> do DOM, ou seja, você para de ouvir todo mundo (enquanto todos
        continuam te ouvindo). O áudio só pode depender de "estou na sala",
        nunca de qual tela está visível.
      */}
      {room && <PeerAudio />}

      <Glass variant="panel" className="flex h-12 shrink-0 items-center gap-3 px-4">
        <span className="truncate text-sm font-semibold text-bright">{title}</span>
        <span className="flex-1 truncate text-[12px] text-dim">
          <ConnectionLabel inText={Boolean(textChannel)} inRoom={Boolean(room)} />
        </span>
        <Tip label={membersOpen ? 'Ocultar membros' : 'Mostrar membros'}>
          <IconButton label="Mostrar/ocultar membros" active={membersOpen} onClick={onToggleMembers}>
            <Users size={18} />
          </IconButton>
        </Tip>
      </Glass>

      <Glass variant="panel" className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {textChannel && guild ? (
          <TextChannel guildId={guild.id} channelId={textChannel.id} />
        ) : room ? (
          <>
            <ShareHud />
            <VoiceStage />
          </>
        ) : (
          <EmptyStage hasGuild={Boolean(guild)} />
        )}
      </Glass>
    </main>
  );
}

function ConnectionLabel({ inText, inRoom }: { inText: boolean; inRoom: boolean }) {
  const connected = useSession((s) => s.connected);
  if (!connected) return <>Reconectando…</>;
  if (inText) return <>{inRoom ? 'Em chamada' : 'Conversa privada'}</>;
  if (!inRoom) return null;

  const others = voice.mesh.peers.size;
  return <>{others ? `${others + 1} participantes` : 'Só você por aqui'}</>;
}

function EmptyStage({ hasGuild }: { hasGuild: boolean }) {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div className="max-w-sm space-y-3">
        <Monitor size={72} className="mx-auto text-dim opacity-40" strokeWidth={1.2} />
        <h2 className="text-lg font-semibold text-bright">
          {hasGuild ? 'Entre em uma sala' : 'Crie um servidor para começar'}
        </h2>
        <p className="text-[13px] text-dim">
          {hasGuild
            ? 'Clique em uma sala à esquerda para conversar e compartilhar sua tela.'
            : 'Servidores são privados: só entra quem tiver o link de convite.'}
        </p>
      </div>
    </div>
  );
}
