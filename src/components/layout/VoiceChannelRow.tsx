import { AnimatePresence, motion } from 'motion/react';
import { Crown, MicOff, Monitor, Volume2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';
import { useSession } from '@/stores/session';
import { UserMenu } from '@/components/members/UserMenu';
import { ChannelMenu } from './ChannelMenu';
import type { Channel, PeerInfo } from '@/types/api';

interface VoiceChannelRowProps {
  guildId: string;
  /** Dono do servidor — ganha a coroa ao lado do nome. */
  ownerId: string;
  channel: Channel;
  occupants: PeerInfo[];
  active: boolean;
  onJoin(): void;
}

/**
 * Uma sala de voz e quem está dentro dela.
 *
 * As linhas de participante entram e saem com `AnimatePresence` e têm `key`
 * pelo sid: o React reaproveita o nó, e a foto de perfil não recarrega a cada
 * atualização de presença (que chega toda vez que alguém abre o microfone).
 * No 3.x era exatamente isso que fazia os avatares piscarem.
 */
export function VoiceChannelRow({ guildId, ownerId, channel, occupants, active, onJoin }: VoiceChannelRowProps) {
  const meId = useSession((s) => s.me?.id);

  return (
    <div>
      <ChannelMenu guildId={guildId} channel={channel}>
        <button
          type="button"
          onClick={onJoin}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm',
            'transition-colors duration-(--duration-fast)',
            active ? 'bg-active text-bright' : 'text-dim hover:bg-hover hover:text-text',
          )}
        >
          <Volume2 size={15} className="shrink-0 opacity-70" />
          <span className="flex-1 truncate text-left">{channel.name}</span>
          {occupants.length > 0 && (
            <span className="rounded-full bg-bg-4 px-1.5 text-[11px] font-semibold text-dim">
              {occupants.length}
            </span>
          )}
        </button>
      </ChannelMenu>

      <AnimatePresence initial={false}>
        {occupants.map((peer) => (
          <motion.div
            key={peer.sid}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 28 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            className="overflow-hidden"
          >
            <UserMenu user={peer.user} sid={peer.sid} guildId={guildId}>
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] py-1 pr-2 pl-6
                              transition-colors hover:bg-hover">
                <Avatar user={peer.user} size="xs" speaking={peer.state?.speaking} />
                <span
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1 truncate text-[12px]',
                    peer.state?.speaking ? 'text-bright' : 'text-dim',
                  )}
                >
                  <span className="truncate">
                    {peer.user.name}
                    {peer.user.id === meId && ' (você)'}
                  </span>
                  {peer.user.id === ownerId && (
                    <Crown size={11} className="shrink-0 text-yellow" aria-label="Dono do servidor" />
                  )}
                </span>
                {peer.state?.screen && <Monitor size={12} className="shrink-0 text-green" />}
                {peer.state && !peer.state.mic && <MicOff size={12} className="shrink-0 text-red" />}
              </div>
            </UserMenu>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
