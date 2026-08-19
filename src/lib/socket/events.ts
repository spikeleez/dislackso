import type {
  AdminAnnouncement, AnnotStrokePatch, ChatMessage, Guild, PeerInfo,
  Presence, ProfilePatch, PublicUser, SessionPayload, VoiceState,
} from '@/types/api';

/** Toda chamada com resposta devolve ou o payload, ou `{ error }`. */
export type Ack<T> = (res: T | { error: string }) => void;

/**
 * Eventos que o cliente dispara. Cada assinatura aqui é um contrato com o
 * servidor — o app 3.x instalado nas máquinas dos usuários fala exatamente
 * estes nomes, então nenhum deles pode ser renomeado.
 */
export interface ClientEvents {
  hello: (p: { userId: string; token: string }, ack: Ack<SessionPayload>) => void;
  'auth:register': (p: { username: string; password: string; name?: string }, ack: Ack<SessionPayload>) => void;
  'auth:login': (p: { username: string; password: string }, ack: Ack<SessionPayload>) => void;
  'auth:claim': (p: { userId: string; username: string; password: string }, ack: Ack<SessionPayload>) => void;

  'user:update': (p: ProfilePatch, ack: Ack<{ user: PublicUser }>) => void;
  'friend:add': (p: { friendId: string }, ack: Ack<{ friends: string[] }>) => void;
  'friend:remove': (p: { friendId: string }, ack: Ack<{ friends: string[] }>) => void;

  'guild:create': (p: { name: string }, ack: Ack<{ guild: Guild }>) => void;
  'guild:join': (p: { invite: string }, ack: Ack<{ guild: Guild }>) => void;
  'guild:update': (p: { guildId: string; name?: string; icon?: string }, ack: Ack<{ guild: Guild }>) => void;
  'guild:leave': (p: { guildId: string }, ack: Ack<{ ok: true }>) => void;
  'guild:delete': (p: { guildId: string }, ack: Ack<{ ok: true }>) => void;
  'guild:regenInvite': (p: { guildId: string }, ack: Ack<{ invite: string }>) => void;

  'channel:create': (p: { guildId: string; name: string; type: 'text' | 'voice' }, ack: Ack<{ guild: Guild }>) => void;
  'channel:delete': (p: { guildId: string; channelId: string }, ack: Ack<{ guild: Guild }>) => void;
  /** Só o dono (ou o admin do app): remove um membro do servidor. */
  'guild:kick': (p: { guildId: string; userId: string }, ack: Ack<{ ok: true }>) => void;
  /** Só o dono (ou o admin do app): manda alguém para outra sala de voz. */
  'voice:move': (p: { guildId: string; channelId: string; userId: string }, ack: Ack<{ ok: true }>) => void;

  'voice:join': (p: { guildId: string; channelId: string }, ack: Ack<{ peers: PeerInfo[] }>) => void;
  'voice:leave': (p: Record<string, never>, ack: Ack<{ ok: true }>) => void;
  'voice:state': (p: VoiceState) => void;
  'rtc:signal': (p: { to: string; data: unknown }) => void;

  'message:history': (p: { guildId: string; channelId: string }, ack: Ack<{ messages: ChatMessage[] }>) => void;
  'message:send': (p: { guildId: string; channelId: string; text: string }, ack: Ack<{ message: ChatMessage }>) => void;

  'screen:preview': (p: { dataUrl: string | null }) => void;
  'annot:draw': (p: AnnotStrokePatch) => void;
  'annot:clear': (p: { target: string }) => void;
}

/** Eventos que o servidor empurra. */
export interface ServerEvents {
  'guild:update': (guild: Guild) => void;
  'guild:deleted': (p: { guildId: string }) => void;
  /** Você foi expulso deste servidor pelo dono. */
  'guild:kicked': (p: { guildId: string }) => void;
  /** O dono te mandou para outra sala de voz — o cliente refaz o join. */
  'voice:moved': (p: { guildId: string; channelId: string }) => void;
  'guild:online': (p: { guildId: string; online: string[] }) => void;
  'user:update': (user: PublicUser) => void;
  'presence:update': (p: { guildId: string; presence: Presence }) => void;

  'voice:peerJoined': (peer: PeerInfo) => void;
  'voice:peerLeft': (p: { sid: string }) => void;
  'voice:state': (p: { sid: string; state: VoiceState }) => void;
  'rtc:signal': (p: { from: string; data: unknown }) => void;

  'message:new': (p: { guildId: string; channelId: string; message: ChatMessage }) => void;
  'screen:preview': (p: { from: string; dataUrl: string | null }) => void;

  'annot:draw': (p: AnnotStrokePatch & { from: string }) => void;
  'annot:clear': (p: { from: string; target: string }) => void;

  'admin:message': (p: AdminAnnouncement) => void;
  /** Disparado quando uma release nova é publicada — ver .github/workflows/build-release.yml. */
  'app:update': (p: { version: string }) => void;
}
