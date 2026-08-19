# Contrato congelado — DiSlackso 4.x

Este documento existe por um motivo só: **nenhuma mudança pode quebrar o que
já está gravado**. Servidores em produção (Render + Supabase) e instalações
antigas do app desktop continuam falando o mesmo protocolo e lendo o mesmo
banco. Qualquer mudança aqui é uma migração, não um refactor.

Adicionar evento novo é permitido (cliente antigo simplesmente ignora);
renomear ou mudar a forma de um existente, não.

## 1. Formato do banco (`data/db.json` e a linha `app_state` no Supabase)

```jsonc
{
  "users": {
    "<uuid>": {
      "id": "<uuid>",
      "username": "string",       // /^[a-zA-Z0-9_]{3,20}$/, único
      "passwordHash": "salt:hash",// scrypt, 16 bytes de salt, 64 de hash
      "token": "hex(32)",         // sessão atual; trocado a cada login
      "name": "string(32)",
      "color": "#rrggbb",
      "accent": "#rrggbb",
      "avatar": "/api/image/<uuid>" | "/uploads/<hex>.png|jpg|gif|webp" | "",
      "banner": "idem" | "",
      "bio": "string(300)",
      "pronouns": "string(20)",
      "friends": ["<uuid>"],
      "createdAt": 1690000000000
    }
  },
  "guilds": {
    "<uuid>": {
      "id": "<uuid>",
      "name": "string(48)",
      "ownerId": "<uuid>",
      "invite": "ABCD2345",       // 8 chars do alfabeto sem I/O/0/1
      "icon": "/api/image/<uuid>" | "/uploads/..." | "",
      "createdAt": 1690000000000,
      "members": ["<uuid>"],
      "channels": [
        { "id": "<uuid>", "name": "string(32)", "type": "text|voice",
          "messages": [ { "id": "<uuid>", "userId": "<uuid>",
                          "text": "string(2000)", "createdAt": 1690000000000 } ] }
      ]
    }
  },
  "usernames": { "<username em minúsculas>": "<uuid do usuário>" },
  "adminUserId": "<uuid>" | null,  // conta com passe livre de dono (painel de dev)
  "images": {
    "<uuid>": { "mime": "image/png|jpeg|gif|webp", "data": "<base64>" }
  }
}
```

Regras invioláveis:
- `messages` fica no disco com no máximo 200 itens por canal; a API devolve 100.
- `publicUser`/`publicGuild` nunca podem vazar `passwordHash` nem `token` de terceiros.
- `usernames` guarda a chave em minúsculas — é o índice de unicidade.
- O espelho no Supabase nunca grava sem antes ter lido o remoto, e nunca grava
  um banco sem usuários por cima de um estado que já teve usuários (proteção
  contra sobrescrever tudo com um boot vazio — ver `server/db/supabase.js`).

## 2. Eventos de socket

Cliente → servidor (todos com callback `(res)` e erro em `res.error`):

| evento | payload | resposta | restrição |
| --- | --- | --- | --- |
| `hello` | `{ userId, token }` | sessão | |
| `auth:register` | `{ username, password, name }` | sessão | |
| `auth:login` | `{ username, password }` | sessão | |
| `auth:claim` | `{ userId, username, password }` | sessão | conta sem senha |
| `user:update` | patch de perfil | `{ user }` | |
| `friend:add` / `friend:remove` | `{ friendId }` | `{ friends }` | |
| `guild:create` | `{ name }` | `{ guild }` | |
| `guild:join` | `{ invite }` | `{ guild }` | |
| `guild:update` | `{ guildId, name?, icon? }` | `{ guild }` | dono/admin |
| `guild:leave` / `guild:delete` | `{ guildId }` | `{ ok }` | delete: dono/admin |
| `guild:regenInvite` | `{ guildId }` | `{ invite }` | dono/admin |
| `guild:kick` | `{ guildId, userId }` | `{ ok }` | dono/admin |
| `channel:create` | `{ guildId, name, type }` | `{ guild }` | dono/admin |
| `channel:delete` | `{ guildId, channelId }` | `{ guild }` | dono/admin |
| `voice:join` | `{ guildId, channelId }` | `{ peers }` | |
| `voice:leave` | — | `{ ok }` | |
| `voice:move` | `{ guildId, channelId, userId }` | `{ ok }` | dono/admin |
| `voice:state` | `{ mic, screen, speaking, annot, streams }` | (sem resposta) | |
| `rtc:signal` | `{ to, data }` | (sem resposta) | mesma sala |
| `message:history` | `{ guildId, channelId }` | `{ messages }` | |
| `message:send` | `{ guildId, channelId, text }` | `{ message }` | |
| `screen:preview` | `{ dataUrl }` | (sem resposta) | |
| `annot:draw` / `annot:clear` | `{ target, ... }` | (sem resposta) | |

> `channel:create` era liberado a qualquer membro até a 4.0.3; virou ação do
> dono junto com o resto da administração. Clientes antigos que tentarem
> recebem o erro normal em `res.error` — nada quebra.

Sessão = `{ user, guilds, iceServers, sid, token, friends, isAdmin }`.

Servidor → cliente: `guild:update`, `guild:deleted`, `guild:kicked`,
`guild:online`, `user:update`, `presence:update`, `voice:peerJoined`,
`voice:peerLeft`, `voice:state`, `voice:moved`, `rtc:signal`, `message:new`,
`screen:preview`, `annot:draw`, `annot:clear`, `admin:message`, `app:update`.

- `guild:kicked` `{ guildId }` — você foi expulso; o cliente remove o servidor.
- `voice:moved` `{ guildId, channelId }` — o dono te moveu; o cliente refaz o
  `voice:join` (o servidor não mexe nas salas do socket).
- `app:update` `{ version }` — release nova publicada com instaladores no ar
  (disparado por `.github/workflows/build-release.yml`).

## 3. HTTP

- `GET /api/health` → `{ ok, guilds, users, supabase, supabaseError, supabaseLastOkAt }`
- `POST /api/upload` → `{ userId, dataUrl, kind: 'avatar'|'banner'|'guild' }` → `{ url: "/api/image/<uuid>" }`
- `GET /api/image/:id` — serve uma imagem enviada; cache imutável de 1 ano (o id muda a cada envio).
- `POST /api/admin/broadcast` → `{ key, message, forceFocus }` → `{ ok, delivered }`
- `POST /api/admin/admin-user` → `{ key, userId? }` → `{ ok, adminUserId }` (`userId` omitido só lê; `''` remove)
- `POST /api/admin/notify-update` → `{ key, version }` → `{ ok, delivered }`
- `GET /uploads/<arquivo>` — estático (uploads antigos, de quando a imagem ia
  pro disco), `immutable`, 7 dias.

## 4. localStorage (prefixo `dsx:`)

`userId`, `authToken`, `name`, `settings`, `guildsCache`, `profileCache`,
`friendsCache`, `membersOpen`, `migrated`.

O prefixo antigo `d2:` continua sendo migrado no primeiro boot. **Não renomear
nenhuma dessas chaves**: quem já está logado seria deslogado.

`dsx:settings` é um objeto plano (sem envelope de middleware); chaves novas de
preferência entram nele com default no código — `micMuted` e `soundOff`
(mudo/ensurdecido persistentes) chegaram assim.

## 5. Ponte do desktop (`window.desktop`)

`isDesktop`, `getConfig`, `setConfig`, `info`, `restart`, `goHome`,
`openExternal`, `focusWindow`, `toggleFullscreen`, `onPickScreen`,
`retryScreenShareWithoutAudio`,
`update.{state,check,download,install,onChange}`.
