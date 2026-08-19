import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { assetUrl } from '@/lib/env';
import type { PublicUser } from '@/types/api';

/**
 * O cartão de perfil de alguém.
 *
 * A cor de destaque é a que a pessoa escolheu, e o banner (quando existe)
 * ocupa o topo — é o único lugar do app em que o visual é dela, não do tema.
 */
export function ProfileDialog({ user, onClose }: { user: PublicUser | null; onClose(): void }) {
  const since = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'long', year: 'numeric',
      })
    : null;

  return (
    <Modal
      open={Boolean(user)}
      onOpenChange={(next) => !next && onClose()}
      title={user?.name ?? ''}
      description={user?.username ? `@${user.username}` : 'Perfil'}
      cancelLabel="Fechar"
      hideConfirm
    >
      {user && (
        <div className="space-y-4">
          <div
            className="h-24 rounded-[var(--radius-md)] bg-cover bg-center"
            /*
              `backgroundColor` em vez do atalho `background`: limpar o atalho
              (`style.background = ''`) reseta o backgroundImage junto — ver o
              comentário em settings/ImageUpload.tsx. A cor fica sempre por
              baixo, então um banner que falhe em carregar degrada para a cor
              de destaque em vez de um retângulo vazio.
            */
            style={{
              backgroundImage: user.banner ? `url('${assetUrl(user.banner)}')` : undefined,
              backgroundColor: user.accent || user.color,
            }}
          />

          <div className="-mt-11 flex items-end gap-3 px-1">
            <Avatar user={user} size="lg" className="ring-4 ring-bg-2" />
            <div className="pb-1">
              <p className="text-base font-semibold text-bright">{user.name}</p>
              {user.pronouns && <p className="text-[12px] text-dim">{user.pronouns}</p>}
            </div>
          </div>

          {user.bio && <p className="text-[13px] whitespace-pre-wrap text-text">{user.bio}</p>}
          {since && <p className="text-[12px] text-dim">No DiSlackso desde {since}.</p>}
        </div>
      )}
    </Modal>
  );
}
