import { useMemo, useState } from 'react';
import { Crown, MicOff, Monitor, Star } from 'lucide-react';
import { Glass } from '@/components/ui/Glass';
import { Avatar } from '@/components/ui/Avatar';
import { ProfileDialog } from '@/components/overlays/ProfileDialog';
import { UserMenu } from './UserMenu';
import { useGuilds } from '@/stores/guilds';
import { useSession } from '@/stores/session';
import { cn } from '@/lib/cn';
import type { PublicUser, VoiceState } from '@/types/api';

/**
 * Quem está no servidor, em duas listas: online e offline.
 *
 * Amigos sobem para o topo dentro de cada lista — numa comunidade grande, é a
 * diferença entre achar seu grupo na hora e rolar por trinta nomes.
 */
export function MembersPanel() {
  const guilds = useGuilds((s) => s.guilds);
  const activeGuildId = useGuilds((s) => s.activeGuildId);
  const onlineMap = useGuilds((s) => s.online);
  const presence = useGuilds((s) => s.presence);
  const friends = useSession((s) => s.friends);
  const meId = useSession((s) => s.me?.id);
  const [profile, setProfile] = useState<PublicUser | null>(null);

  const guild = guilds.find((g) => g.id === activeGuildId) ?? null;
  const online = activeGuildId ? (onlineMap[activeGuildId] ?? new Set<string>()) : new Set<string>();

  // Quem está em alguma sala de voz agora, indexado por id de usuário — é o
  // que traz o ícone de mudo/tela pra cá, igual já existe na lista de canais.
  const inVoice = useMemo(() => {
    const map = new Map<string, { sid: string; state: VoiceState }>();
    const guildPresence = activeGuildId ? (presence[activeGuildId] ?? {}) : {};
    for (const peers of Object.values(guildPresence)) {
      for (const peer of peers) map.set(peer.user.id, { sid: peer.sid, state: peer.state });
    }
    return map;
  }, [presence, activeGuildId]);

  const { here, away } = useMemo(() => {
    const sorted = [...(guild?.members ?? [])].sort((a, b) => {
      const fa = friends.has(a.id);
      const fb = friends.has(b.id);
      if (fa !== fb) return fa ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return {
      here: sorted.filter((m) => online.has(m.id)),
      away: sorted.filter((m) => !online.has(m.id)),
    };
  }, [guild, friends, online]);

  return (
    <Glass as="aside" variant="panel" className="flex h-full w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        <MemberSection label="Online" members={here} online />
        <MemberSection label="Offline" members={away} />
      </div>
      <ProfileDialog user={profile} onClose={() => setProfile(null)} />
    </Glass>
  );

  function MemberSection({
    label,
    members,
    online: isOnline,
  }: {
    label: string;
    members: PublicUser[];
    online?: boolean;
  }) {
    if (!members.length) return null;

    return (
      <>
        <div className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-dim uppercase">
          {label} — {members.length}
        </div>
        {members.map((member) => {
          const inCall = inVoice.get(member.id);
          return (
            <UserMenu key={member.id} user={member} sid={inCall?.sid} guildId={guild?.id}>
              <button
                type="button"
                onClick={() => setProfile(member)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5',
                  'text-left transition-colors duration-(--duration-fast) hover:bg-hover',
                  !isOnline && 'opacity-45',
                )}
              >
                <Avatar user={member} size="sm" speaking={inCall?.state.speaking} />
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-[13px] text-text">
                  <span className="truncate">
                    {member.name}
                    {member.id === meId && ' (você)'}
                  </span>
                  {/* Coroa junto do nome; a estrela de amigo continua na ponta direita. */}
                  {member.id === guild?.ownerId && (
                    <Crown size={12} className="shrink-0 text-yellow" aria-label="Dono do servidor" />
                  )}
                </span>
                {inCall?.state.screen && <Monitor size={12} className="shrink-0 text-green" />}
                {inCall && !inCall.state.mic && <MicOff size={12} className="shrink-0 text-red" />}
                {friends.has(member.id) && (
                  <Star size={12} className="shrink-0 fill-yellow text-yellow" aria-label="Amigo" />
                )}
              </button>
            </UserMenu>
          );
        })}
      </>
    );
  }
}
