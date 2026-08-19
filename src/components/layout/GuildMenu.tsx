import { useState, type ReactNode } from 'react';
import { Hash, Link2, LogOut, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react';
import { DropMenu, type MenuAction } from '@/components/ui/Menu';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput } from '@/components/ui/Field';
import { InviteDialog } from '@/components/overlays/GuildDialogs';
import { ServerSettingsDialog } from '@/components/overlays/ServerSettingsDialog';
import { createChannel, deleteGuild, leaveGuild, regenerateInvite } from '@/features/guilds/actions';
import { useSession } from '@/stores/session';
import type { Guild } from '@/types/api';

type Dialog = 'invite' | 'newtext' | 'newvoice' | 'settings' | 'leave' | 'delete' | null;

interface GuildMenuProps {
  guild: Guild;
  dialog: string | null;
  onDialog(dialog: string | null): void;
  children: ReactNode;
}

/** O menu "⋮" do servidor e todas as janelas que ele abre. */
export function GuildMenu({ guild, dialog, onDialog, children }: GuildMenuProps) {
  const isOwner = useSession((s) => s.me?.id) === guild.ownerId;
  const isAdmin = useSession((s) => s.isAdmin);
  const [invite, setInvite] = useState(guild.invite);
  const open = dialog as Dialog;

  const actions: MenuAction[] = [
    {
      id: 'invite',
      label: 'Convidar amigos',
      icon: <Link2 size={16} />,
      onSelect: () => { setInvite(guild.invite); onDialog('invite'); },
    },
    // Criar canal virou ação do dono (o servidor também barra; ver socket/guilds.js).
    {
      id: 'newtext',
      label: 'Criar canal de texto',
      icon: <Hash size={16} />,
      disabled: !isOwner && !isAdmin,
      onSelect: () => onDialog('newtext'),
    },
    {
      id: 'newvoice',
      label: 'Criar sala de voz',
      icon: <Plus size={16} />,
      disabled: !isOwner && !isAdmin,
      onSelect: () => onDialog('newvoice'),
    },
    {
      id: 'regen',
      label: 'Gerar novo convite',
      icon: <RefreshCw size={16} />,
      disabled: !isOwner && !isAdmin,
      onSelect: () => void regenerate(),
    },
    { id: 'settings', label: 'Configurações do servidor', icon: <Settings size={16} />, onSelect: () => onDialog('settings') },
    {
      id: 'leave',
      label: 'Sair do servidor',
      icon: <LogOut size={16} />,
      danger: true,
      separatorBefore: true,
      disabled: isOwner,
      onSelect: () => onDialog('leave'),
    },
    {
      id: 'delete',
      label: 'Excluir servidor',
      icon: <Trash2 size={16} />,
      danger: true,
      disabled: !isOwner && !isAdmin,
      onSelect: () => onDialog('delete'),
    },
  ];

  async function regenerate() {
    const code = await regenerateInvite(guild.id);
    if (!code) return;
    setInvite(code);
    onDialog('invite');
  }

  return (
    <>
      <DropMenu trigger={children} actions={actions} align="end" />

      <InviteDialog
        guild={open === 'invite' ? { ...guild, invite } : null}
        onClose={() => onDialog(null)}
      />

      <NewChannelDialog
        guildId={guild.id}
        type={open === 'newtext' ? 'text' : 'voice'}
        open={open === 'newtext' || open === 'newvoice'}
        onClose={() => onDialog(null)}
      />

      <ServerSettingsDialog
        guild={open === 'settings' ? guild : null}
        onClose={() => onDialog(null)}
      />

      <Modal
        open={open === 'leave'}
        onOpenChange={(next) => !next && onDialog(null)}
        title="Sair do servidor"
        description={`Você vai perder o acesso a ${guild.name} e precisará de um novo convite para voltar.`}
        confirmLabel="Sair"
        danger
        onConfirm={() => void leaveGuild(guild.id)}
      />

      <Modal
        open={open === 'delete'}
        onOpenChange={(next) => !next && onDialog(null)}
        title="Excluir servidor"
        description={`Isso apaga ${guild.name} para todos os membros. Não dá para desfazer.`}
        confirmLabel="Excluir"
        danger
        onConfirm={() => void deleteGuild(guild.id)}
      />
    </>
  );
}

interface NewChannelProps {
  guildId: string;
  type: 'text' | 'voice';
  open: boolean;
  onClose(): void;
}

function NewChannelDialog({ guildId, type, open, onClose }: NewChannelProps) {
  const [name, setName] = useState('');
  const isText = type === 'text';

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={isText ? 'Criar canal de texto' : 'Criar sala de voz'}
      confirmLabel="Criar"
      onConfirm={async () => {
        if (!name.trim()) return false;
        await createChannel(guildId, name.trim(), type);
        setName('');
      }}
    >
      <Field label="Nome da sala">
        {(id) => (
          <TextInput
            id={id}
            value={name}
            maxLength={32}
            autoFocus
            placeholder={isText ? 'Ex: conversa-geral' : 'Ex: Sala 2'}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
    </Modal>
  );
}
