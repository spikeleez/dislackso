import { useState, type ReactNode } from 'react';
import {
  ArrowRightLeft, Star, StarOff, User, UserPlus, UserX, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { RightClickMenu, type MenuAction } from '@/components/ui/Menu';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ProfileDialog } from '@/components/overlays/ProfileDialog';
import { kickMember, moveMember, toggleFriend } from '@/features/guilds/actions';
import { useGuilds } from '@/stores/guilds';
import { useRoom } from '@/stores/room';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toasts';
import type { PublicUser } from '@/types/api';

interface UserMenuProps {
  user: PublicUser;
  /** Presente quando a pessoa está numa sala de voz deste servidor. */
  sid?: string;
  /** Servidor em cujo contexto o menu abriu — habilita as ações de dono. */
  guildId?: string;
  children: ReactNode;
}

/**
 * Botão direito num usuário.
 *
 * As opções de áudio (mutar, volume) valem **só para mim** — não afetam o que
 * os outros ouvem. Por isso só aparecem para quem está na mesma sala de voz:
 * fora dela não há áudio nenhum para ajustar.
 *
 * As ações de moderação (mover de sala, expulsar) só aparecem para o dono do
 * servidor (ou o admin do app) — o servidor valida de novo de qualquer jeito,
 * mas mostrar um botão que sempre falha só ensina a desconfiar do menu.
 */
export function UserMenu({ user, sid, guildId, children }: UserMenuProps) {
  const me = useSession((s) => s.me);
  const isAdmin = useSession((s) => s.isAdmin);
  const friends = useSession((s) => s.friends);
  const localMutes = useRoom((s) => s.localMutes);
  const guild = useGuilds((s) => s.guilds.find((g) => g.id === guildId) ?? null);
  const [profile, setProfile] = useState(false);
  const [confirmKick, setConfirmKick] = useState(false);
  const [movePicker, setMovePicker] = useState(false);

  const isMe = me?.id === user.id;
  const isFriend = friends.has(user.id);
  const muted = Boolean(sid && localMutes.has(sid));
  const canModerate = Boolean(guild && !isMe && (me?.id === guild.ownerId || isAdmin));
  const voiceChannels = guild?.channels.filter((c) => c.type !== 'text') ?? [];

  const actions: MenuAction[] = [];

  if (sid && !isMe) {
    actions.push(
      {
        id: 'mute',
        label: muted ? 'Desmutar' : 'Mutar só pra mim',
        icon: muted ? <Volume2 size={16} /> : <VolumeX size={16} />,
        onSelect: () => useRoom.getState().toggleMute(sid),
      },
      {
        id: 'vol-down',
        label: 'Diminuir volume',
        icon: <Volume1 size={16} />,
        onSelect: () => bumpVolume(sid, -0.2),
      },
      {
        id: 'vol-up',
        label: 'Aumentar volume',
        icon: <Volume2 size={16} />,
        onSelect: () => bumpVolume(sid, 0.2),
      },
    );
  }

  if (!isMe) {
    actions.push({
      id: 'friend',
      label: isFriend ? 'Remover dos amigos' : 'Adicionar como amigo',
      icon: isFriend ? <StarOff size={16} /> : <UserPlus size={16} />,
      separatorBefore: actions.length > 0,
      onSelect: () => void toggleFriend(user.id, !isFriend),
    });
  }

  actions.push({
    id: 'profile',
    label: 'Ver perfil',
    icon: <User size={16} />,
    separatorBefore: actions.length > 0,
    onSelect: () => setProfile(true),
  });

  if (canModerate) {
    if (sid && voiceChannels.length > 1) {
      actions.push({
        id: 'move',
        label: 'Mover para outra sala…',
        icon: <ArrowRightLeft size={16} />,
        separatorBefore: true,
        onSelect: () => setMovePicker(true),
      });
    }
    actions.push({
      id: 'kick',
      label: 'Expulsar do servidor',
      icon: <UserX size={16} />,
      danger: true,
      separatorBefore: !(sid && voiceChannels.length > 1),
      onSelect: () => setConfirmKick(true),
    });
  }

  return (
    <>
      <RightClickMenu actions={actions}>{children}</RightClickMenu>
      <ProfileDialog user={profile ? user : null} onClose={() => setProfile(false)} />

      {canModerate && guild && (
        <>
          <Modal
            open={confirmKick}
            onOpenChange={setConfirmKick}
            title="Expulsar do servidor"
            description={`${user.name} sai de ${guild.name} agora e só volta com um novo convite.`}
            confirmLabel="Expulsar"
            danger
            onConfirm={() => void kickMember(guild.id, user.id)}
          />

          <Modal
            open={movePicker}
            onOpenChange={setMovePicker}
            title="Mover para outra sala"
            description={`Escolha para onde mandar ${user.name}.`}
            hideConfirm
            cancelLabel="Cancelar"
          >
            <div className="space-y-1.5">
              {voiceChannels.map((channel) => (
                <Button
                  key={channel.id}
                  size="block"
                  onClick={() => {
                    setMovePicker(false);
                    void moveMember(guild.id, channel.id, user.id);
                  }}
                >
                  {channel.name}
                </Button>
              ))}
            </div>
          </Modal>
        </>
      )}
    </>
  );
}

function bumpVolume(sid: string, delta: number): void {
  const next = useRoom.getState().bumpVolume(sid, delta);
  toast(`Volume de quem tá falando: ${Math.round(next * 100)}%`);
}
