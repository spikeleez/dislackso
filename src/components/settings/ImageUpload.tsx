import { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { assetUrl } from '@/lib/env';
import { MAX_UPLOAD_BYTES, pickImage, updateProfile, uploadImage } from '@/features/profile/actions';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toasts';
import { cn } from '@/lib/cn';

interface ImageUploadProps {
  kind: 'avatar' | 'banner';
  current: string;
  label: string;
  fallbackColor: string;
  fallbackText: string;
  wide?: boolean;
}

/** Prévia + enviar + remover. O fluxo é o mesmo para foto de perfil e banner. */
export function ImageUpload({ kind, current, label, fallbackColor, fallbackText, wide }: ImageUploadProps) {
  const me = useSession((s) => s.me);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const dataUrl = await pickImage(MAX_UPLOAD_BYTES);
    if (!dataUrl || !me) return;
    setBusy(true);
    try {
      const url = await uploadImage(dataUrl, kind, me.id);
      await updateProfile({ [kind]: url });
    } catch (err) {
      toast(`Falha ao enviar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex gap-3', wide ? 'flex-col' : 'items-center')}>
      <div
        className={cn(
          'grid place-items-center overflow-hidden bg-cover bg-center text-[11px] text-white/80',
          wide ? 'h-24 w-full rounded-[var(--radius-md)]' : 'size-20 rounded-full',
        )}
        /*
          `backgroundColor`, nunca o atalho `background`: o React limpa uma
          propriedade que sai do objeto atribuindo string vazia, e
          `style.background = ''` reseta TODAS as sub-propriedades — inclusive
          o backgroundImage recém-definido na mesma atualização. Era por isso
          que enviar uma foto nova "funcionava" mas a prévia daqui ficava em
          branco.
        */
        style={{
          backgroundImage: current ? `url('${assetUrl(current)}')` : undefined,
          backgroundColor: current ? undefined : fallbackColor,
        }}
      >
        {!current && fallbackText}
      </div>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void send()}>
          <Upload size={15} /> {busy ? 'Enviando…' : label}
        </Button>
        {current && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void updateProfile({ [kind]: '' })}
          >
            <Trash2 size={15} /> Remover
          </Button>
        )}
      </div>
    </div>
  );
}
