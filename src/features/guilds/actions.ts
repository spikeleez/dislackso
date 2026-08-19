import { ask } from '@/lib/socket/client';
import { inviteOrigin } from '@/lib/env';
import { useGuilds } from '@/stores/guilds';
import { useRoom } from '@/stores/room';
import { useSession } from '@/stores/session';
import { toast } from '@/stores/toasts';
import { leaveVoice } from '@/features/voice/actions';
import type { Guild } from '@/types/api';

/** Roda a chamada, mostra o erro num aviso e devolve `null` se falhar. */
async function attempt<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    toast((err as Error).message);
    return null;
  }
}

export async function createGuild(name: string): Promise<Guild | null> {
  const res = await attempt(() => ask('guild:create', { name }));
  if (!res) return null;
  useGuilds.getState().upsert(res.guild);
  useGuilds.getState().openGuild(res.guild.id);
  return res.guild;
}

export async function joinGuild(invite: string): Promise<Guild | null> {
  const res = await attempt(() => ask('guild:join', { invite }));
  if (!res) return null;
  useGuilds.getState().upsert(res.guild);
  useGuilds.getState().openGuild(res.guild.id);
  toast(`Você entrou em ${res.guild.name}.`);
  return res.guild;
}

export async function updateGuild(
  guildId: string,
  patch: { name?: string; icon?: string },
): Promise<void> {
  if (!Object.keys(patch).length) return;
  const res = await attempt(() => ask('guild:update', { guildId, ...patch }));
  if (res) toast('Configurações do servidor atualizadas.');
}

export async function regenerateInvite(guildId: string): Promise<string | null> {
  const res = await attempt(() => ask('guild:regenInvite', { guildId }));
  return res?.invite ?? null;
}

export async function leaveGuild(guildId: string): Promise<void> {
  const res = await attempt(() => ask('guild:leave', { guildId }));
  if (!res) return;
  if (useRoom.getState().room?.guildId === guildId) await leaveVoice({ silent: true });
  useGuilds.getState().remove(guildId);
}

export async function deleteGuild(guildId: string): Promise<void> {
  // O servidor emite `guild:deleted` para todo mundo, inclusive para mim —
  // é lá que a remoção local acontece, então aqui não mexemos no store.
  await attempt(() => ask('guild:delete', { guildId }));
}

export async function createChannel(
  guildId: string,
  name: string,
  type: 'text' | 'voice',
): Promise<void> {
  const res = await attempt(() => ask('channel:create', { guildId, name, type }));
  if (res) useGuilds.getState().upsert(res.guild);
}

export async function deleteChannel(guildId: string, channelId: string): Promise<void> {
  const res = await attempt(() => ask('channel:delete', { guildId, channelId }));
  if (!res) return;
  useGuilds.getState().upsert(res.guild);
  const current = useRoom.getState().room;
  if (current?.guildId === guildId && current.channelId === channelId) {
    await leaveVoice({ silent: true });
  }
}

export async function kickMember(guildId: string, userId: string): Promise<void> {
  // O servidor emite `guild:update` para a sala; a lista de membros de todo
  // mundo (inclusive a minha) se atualiza por lá.
  const res = await attempt(() => ask('guild:kick', { guildId, userId }));
  if (res) toast('Membro removido do servidor.');
}

export async function moveMember(guildId: string, channelId: string, userId: string): Promise<void> {
  const res = await attempt(() => ask('voice:move', { guildId, channelId, userId }));
  if (res) toast('Membro movido de sala.');
}

export async function toggleFriend(userId: string, add: boolean): Promise<void> {
  const res = await attempt(() => ask(add ? 'friend:add' : 'friend:remove', { friendId: userId }));
  if (res) useSession.getState().setFriends(res.friends);
}

/** O link que se manda para alguém entrar no servidor. */
export function inviteLink(invite: string): string {
  return `${inviteOrigin()}/#invite=${invite}`;
}

/** Aceita tanto o código puro quanto o link inteiro colado. */
export function parseInvite(raw: string): string {
  const match = raw.match(/invite=([A-Za-z0-9]+)/);
  return (match?.[1] ?? raw).trim().toUpperCase();
}
