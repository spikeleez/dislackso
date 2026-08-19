import { useState } from 'react';
import { Hash, MoreVertical, Settings } from 'lucide-react';
import { Glass } from '@/components/ui/Glass';
import { IconButton } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Tip } from '@/components/ui/Tooltip';
import { activeGuild, useGuilds } from '@/stores/guilds';
import { useRoom } from '@/stores/room';
import { useSession } from '@/stores/session';
import { openTextChannel } from '@/features/messages/actions';
import { joinVoice } from '@/features/voice/actions';
import { cn } from '@/lib/cn';
import { GuildMenu } from './GuildMenu';
import { VoiceChannelRow } from './VoiceChannelRow';
import { CallBar } from './CallBar';
import { ChannelMenu } from './ChannelMenu';

interface ChannelSidebarProps {
  onOpenSettings(section: string): void;
}

/**
 * A coluna de canais do servidor selecionado, com o cartão da própria conta
 * embaixo. É o "onde eu estou e para onde posso ir" do app.
 */
export function ChannelSidebar({ onOpenSettings }: ChannelSidebarProps) {
  const guilds = useGuilds((s) => s.guilds);
  const activeGuildId = useGuilds((s) => s.activeGuildId);
  const activeTextChannelId = useGuilds((s) => s.activeTextChannelId);
  const presence = useGuilds((s) => s.presence);
  const room = useRoom((s) => s.room);

  const guild = guilds.find((g) => g.id === activeGuildId) ?? null;
  const [dialog, setDialog] = useState<string | null>(null);

  const textChannels = guild?.channels.filter((c) => c.type === 'text') ?? [];
  const voiceChannels = guild?.channels.filter((c) => c.type !== 'text') ?? [];

  return (
    <Glass as="aside" variant="panel" className="flex w-46 shrink-0 flex-col xl:w-58">
      <header className="flex h-12 items-center gap-2 border-b border-line px-3">
        <span className="flex-1 truncate text-sm font-semibold text-bright">
          {guild?.name ?? 'Selecione um servidor'}
        </span>
        {guild && (
          <GuildMenu guild={guild} dialog={dialog} onDialog={setDialog}>
            <IconButton label="Opções do servidor">
              <MoreVertical size={18} />
            </IconButton>
          </GuildMenu>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {textChannels.length > 0 && <SectionLabel>Canais de texto</SectionLabel>}
        {textChannels.map((channel) => (
          <ChannelMenu key={channel.id} guildId={guild!.id} channel={channel}>
            <button
              type="button"
              onClick={() => void openTextChannel(guild!.id, channel.id)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm',
                'transition-colors duration-(--duration-fast)',
                activeTextChannelId === channel.id
                  ? 'bg-active text-bright'
                  : 'text-dim hover:bg-hover hover:text-text',
              )}
            >
              <Hash size={15} className="shrink-0 opacity-70" />
              <span className="truncate">{channel.name}</span>
            </button>
          </ChannelMenu>
        ))}

        {voiceChannels.length > 0 && <SectionLabel>Salas de voz e tela</SectionLabel>}
        {voiceChannels.map((channel) => (
          <VoiceChannelRow
            key={channel.id}
            guildId={guild!.id}
            ownerId={guild!.ownerId}
            channel={channel}
            occupants={presence[guild!.id]?.[channel.id] ?? []}
            active={room?.guildId === guild!.id && room.channelId === channel.id}
            onJoin={() => void joinVoice(guild!.id, channel.id)}
          />
        ))}
      </div>

      <UserCard onOpenSettings={onOpenSettings} />
    </Glass>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-dim uppercase">
      {children}
    </div>
  );
}

function UserCard({ onOpenSettings }: { onOpenSettings(section: string): void }) {
  const me = useSession((s) => s.me);
  const connected = useSession((s) => s.connected);
  const inRoom = Boolean(useRoom((s) => s.room));

  const status = !connected ? 'Reconectando…' : inRoom ? 'Em uma sala' : 'Disponível';

  return (
    <footer className="border-t border-line">
      <CallBar inRoom={inRoom} onOpenSettings={onOpenSettings} />

      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={() => onOpenSettings('conta')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] p-1
                     text-left transition-colors hover:bg-hover"
        >
          <Avatar user={me} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-bright">{me?.name}</span>
            <span className={cn('block truncate text-[11px]', connected ? 'text-dim' : 'text-yellow')}>
              {status}
            </span>
          </span>
        </button>

        <Tip label="Configurações">
          <IconButton label="Configurações" onClick={() => onOpenSettings('aparencia')}>
            <Settings size={18} />
          </IconButton>
        </Tip>
      </div>
    </footer>
  );
}
