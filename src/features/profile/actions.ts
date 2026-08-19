import { ask } from '@/lib/socket/client';
import { serverUrl } from '@/lib/env';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toasts';
import type { ProfilePatch } from '@/types/api';

/** Tamanho máximo aceito pelo servidor. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export async function updateProfile(patch: ProfilePatch): Promise<void> {
  try {
    const { user } = await ask('user:update', patch);
    useSession.getState().setMe(user);
  } catch (err) {
    toast(`Não consegui salvar: ${(err as Error).message}`);
  }
}

/** Abre o seletor de arquivos e devolve um data URL, ou `null` se cancelou. */
export function pickImage(maxBytes = MAX_UPLOAD_BYTES): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > maxBytes) {
        toast(`Imagem muito grande (máx. ${Math.round(maxBytes / 1024 / 1024)} MB).`);
        return resolve(null);
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => {
        toast('Não consegui ler o arquivo.');
        resolve(null);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/** Lado máximo por tipo de imagem — nenhum deles é exibido maior que isso. */
const MAX_SIDE: Record<'avatar' | 'banner' | 'guild', number> = {
  avatar: 512,
  banner: 1920,
  guild: 512,
};

/**
 * Reduz a imagem para o tamanho em que ela realmente é exibida.
 *
 * Não é só economia de banda: as imagens moram DENTRO do banco (`db.images`),
 * e o banco inteiro é espelhado no Supabase a cada gravação. Uma foto de
 * câmera de 10 MB vira ~13 MB de base64 no payload de TODO save — foi isso
 * que começou a derrubar o espelhamento (e com ele, a persistência de todo
 * mundo). Um avatar de 512px em WEBP fica na casa dos poucos KB.
 *
 * GIF passa direto: canvas só enxerga o primeiro quadro e mataria a animação.
 */
async function shrinkImage(dataUrl: string, kind: 'avatar' | 'banner' | 'guild'): Promise<string> {
  if (dataUrl.startsWith('data:image/gif')) return dataUrl;

  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = dataUrl;
  });
  if (!img?.width || !img.height) return dataUrl; // não decodificou: o servidor valida

  const max = MAX_SIDE[kind];
  const scale = Math.min(1, max / Math.max(img.width, img.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const out = canvas.toDataURL('image/webp', 0.85);
  // PNG pequeno pode "crescer" ao virar WEBP; só troca quando compensa.
  return out.length < dataUrl.length ? out : dataUrl;
}

/**
 * Envia a imagem e devolve o caminho salvo (`/api/image/...`).
 *
 * Sobe como data URL de propósito: aceita GIF animado sem o servidor precisar
 * reprocessar a imagem (o que mataria a animação).
 */
export async function uploadImage(
  dataUrl: string,
  kind: 'avatar' | 'banner' | 'guild',
  userId: string,
): Promise<string> {
  const shrunk = await shrinkImage(dataUrl, kind);
  const res = await fetch(`${serverUrl()}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl: shrunk, kind, userId }),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? 'falha no envio');
  return json.url;
}
