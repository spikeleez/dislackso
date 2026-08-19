# Servidor e dados

Node + Express + Socket.IO, **CommonJS puro** (`'use strict'`, `require`). Sem
TypeScript, sem transpilação — é o que mantém o empacotamento no Electron
simples. Não converta.

`createServer(options)` é exportado por `server/index.js`; `server.js` é só o
entrypoint standalone.

## O banco

Um objeto em memória, gravado em `data/db.json` e (opcionalmente) espelhado no
Postgres do Supabase.

```jsonc
{
  "users":     { "<uuid>": { …, "passwordHash": "salt:hash", "token": "hex(32)" } },
  "guilds":    { "<uuid>": { …, "invite": "ABCD2345", "members": [], "channels": [] } },
  "usernames": { "<nickname minúsculo>": "<uuid>" },   // índice de unicidade
  "adminUserId": "<uuid>" | null,                       // 4.0.3
  "images":    { "<uuid>": { "mime": "image/png", "data": "<base64>" } }  // 4.0.3
}
```

### Gravação

`store.save()` agrupa rajadas num debounce de **250 ms**, escreve em
`db.json.tmp` e faz `rename` — atômico no sistema de arquivos. Sem isso, uma
queda no meio da escrita deixaria JSON truncado, ou seja, **todos os dados
perdidos**.

### Espelho Supabase (`server/db/supabase.js`)

Uma linha só, na tabela `app_state` (`supabase/schema.sql`):

```sql
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{"users":{},"guilds":{}}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
-- sem políticas públicas: só o servidor, via service_role
```

Existe por um motivo concreto: **no Render o disco é efêmero**. Sem o espelho,
todo redeploy zera contas, servidores e conversas.

`store.restore()` roda **antes** de aceitar conexões (`listen()`), para
ninguém ver o banco vazio. Save é `POST` com
`Prefer: resolution=merge-duplicates` (upsert por `id`).

`describeFetchError()` existe porque `"fetch failed"` do Node não diz nada —
o motivo real está em `err.cause.code`.

Variáveis: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_ROW_ID`
(padrão `main`). Sem elas, tudo funciona só com o disco local.

`GET /api/health` devolve `supabase`, `supabaseError` e `supabaseLastOkAt`
justamente para diagnosticar "por que as contas somem depois de um deploy".

## Privacidade: `db/shapes.js`

`publicUser` e `publicGuild` são **a barreira de privacidade do sistema**. É
aqui, e só aqui, que se decide o que sai para a rede. `passwordHash` e `token`
nunca atravessam essas funções.

`publicGuild` também retira `messages` dos canais — elas chegam sob demanda
por `message:history`.

## Senhas (`server/util.js`)

`scrypt` do Node (sem dependência nativa, empacota bem no Electron):
`salt(16 bytes hex) : hash(64 bytes hex)`. Verificação com
`crypto.timingSafeEqual` — senão o tempo de resposta vaza o hash.

Login com usuário inexistente e login com senha errada devolvem **a mesma
mensagem** ("Nickname ou senha incorretos."): dizer qual dos dois falhou
entregaria quais nicknames existem.

## Autenticação

| Evento | Faz |
|---|---|
| `hello` | retomada silenciosa: exige `userId` + `token` batendo |
| `auth:register` | nickname `/^[a-zA-Z0-9_]{3,20}$/`, senha ≥ 6 |
| `auth:login` | verifica hash, **gera token novo** |
| `auth:claim` | adota conta anônima antiga (sem senha) preservando servidores e avatar |

`auth:claim` só funciona enquanto a conta **não tiver senha** — depois seria
uma forma de tomar a conta de outra pessoa. `features/auth/actions.ts` cobre
o caso do id salvo já não existir no servidor: cai para `auth:register` em vez
de deixar o usuário preso num erro sem saída.

Cada login **troca o token**, invalidando a sessão anterior.

Não há e-mail nem recuperação de senha, de propósito: SMTP + verificação +
reset seria mais infraestrutura que o resto do servidor inteiro.

## Presença (`server/socket/presence.js`)

Duas salas do Socket.IO por assunto:

- `guild:<guildId>` — todo mundo com o app aberto naquele servidor;
- `voice:<guildId>/<channelId>` — quem está na sala de voz.

E duas noções distintas, emitidas separadamente:

| Evento | Significa | Frequência |
|---|---|---|
| `presence:update` | quem está em cada sala de voz | alta (todo "está falando") |
| `guild:online` | quem está com o app aberto | baixa |

`sessions: Map<socketId, { userId, room, state }>`. No `disconnect`, a sessão é
apagada **antes** de recalcular `pushOnline` — se houver outra aba ou aparelho
com o mesmo usuário, ele continua online.

`evictVoiceRoom()` tira todo mundo de uma sala quando o canal deixa de existir.

## Autorização em servidores (`server/socket/guilds.js`)

| Ação | Quem pode |
|---|---|
| `guild:create`, `guild:join` | qualquer autenticado |
| `guild:update`, `guild:delete`, `guild:regenInvite` | **dono** ou admin do app |
| `channel:create`, `channel:delete` | **dono** ou admin do app |
| `guild:kick` (expulsar membro) | **dono** ou admin do app; o dono não pode ser expulso |
| `voice:move` (mover de sala de voz) | **dono** ou admin do app |
| `guild:leave` | qualquer membro, **menos o dono** (ele tem de excluir) |

(`channel:create` era liberado a qualquer membro até a 4.0.3.) Limite:
`MAX_CHANNELS = 40`.

`guild:kick` remove o membro, derruba as sessões dele no servidor (sala de voz
inclusive) e emite `guild:kicked` para os sockets dele. `voice:move` só emite
`voice:moved` para o alvo — é o cliente quem refaz o `voice:join`, para o
motor de mídia desmontar e remontar as conexões pelo caminho normal.

Convites: 8 caracteres do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — **sem
I, O, 0 e 1**, para ditar por voz sem erro. O código **é** a credencial daquele
servidor; `guild:regenInvite` mata o anterior na hora.

`guild:delete` emite `guild:deleted` **antes** de apagar — depois não haveria
mais sala para emitir.

## Mensagens (`server/socket/messages.js`)

- `KEEP_ON_DISK = 200` por canal, `SEND_ON_HISTORY = 100`,
  `MAX_MESSAGE_CHARS = 2000`.
- `message:new` vai para o **servidor inteiro** (`guild:<id>`), não só para
  quem está com o canal aberto — é o que faz a notificação chegar a quem está
  em outra tela.

Histórico curto é decisão consciente: o banco é um JSON carregado inteiro na
memória a cada boot.

## Uploads e imagens

**Mudou na 4.0.3.** Antes as imagens iam para o disco (`/uploads/<hex>.png`);
hoje viram registro em `db.images` e são servidas por `GET /api/image/:id`.

Por quê: no Render o disco é efêmero (imagem sumia a cada redeploy), e a
correção ingênua — embutir a data URL direto em `user.avatar` — estourava o
`maxHttpBufferSize` do Socket.IO, porque o registro do usuário viaja inteiro
em login, presença e lista de membros. Como registro à parte, só o id curto
circula pelo protocolo e cada `<img>` busca a própria foto.

`POST /api/upload` aceita `{ userId, dataUrl, kind: 'avatar'|'banner'|'guild' }`.
Valida MIME contra `IMAGE_TYPES` (PNG, JPEG, GIF, WEBP) e tamanho aproximado
≤ 12 MB. Sobe como data URL de propósito: preserva GIF animado sem
reprocessamento.

`cleanAssetPath()` (`util.js`) é a trava: só aceita
`/uploads/<slug>.(png|jpg|gif|webp)` (legado) ou `/api/image/<uuid>`.
**Não aceita `data:` direto.** Devolve `undefined` para inválido — distinto de
`''` (apagar a imagem) — e o chamador recusa em vez de apagar o que a pessoa
já tinha.

A rota estática `/uploads` continua existindo (`maxAge: 7d, immutable`) para
os arquivos antigos.

## Rotas de admin

Todas exigem `key` no corpo, comparada com `ADMIN_KEY` do ambiente. Sem
`ADMIN_KEY` configurado → 503. Sem sessão de usuário: o painel de dev do
desktop não tem login.

| Rota | Faz |
|---|---|
| `POST /api/admin/broadcast` | `{ key, message, forceFocus }` → emite `admin:message` para todos |
| `POST /api/admin/admin-user` | lê/define `db.adminUserId` (`userId: ''` remove) |
| `POST /api/admin/notify-update` | `{ key, version }` → emite `app:update`; chamado pelo workflow de release **depois** que os instaladores subiram |

A conta em `adminUserId` recebe `isAdmin: true` no payload de sessão e passa
por qualquer "só o dono pode" em qualquer servidor.

## CORS (`server/http/cors.js`)

O desktop chama a API a partir de `app://local`, então **toda** requisição é
entre origens distintas. Sem o middleware, o preflight é bloqueado e upload de
avatar/banner/ícone falha em silêncio. Reflete a origem, `Vary: Origin`,
métodos `GET,POST,OPTIONS`. Não há cookie de sessão — a identidade viaja no
corpo — então refletir a origem sem credenciais não abre superfície nova.

O Socket.IO já usa `cors: { origin: true, credentials: true }` em
`server/index.js`, com `maxHttpBufferSize: 2e6`.

## HTTPS local

Se `certs/key.pem` e `certs/cert.pem` existirem (via `npm run cert`), o
servidor sobe em HTTPS sozinho — `getDisplayMedia` e `getUserMedia` só
funcionam em contexto seguro fora de `localhost`.

---

## O contrato

[`docs/CONTRATO.md`](CONTRATO.md) foi atualizado nesta rodada e reflete o
código (banco com `adminUserId`/`images`, sessão com `isAdmin`, rotas de
imagem e admin, eventos `guild:kick`/`voice:move`/`guild:kicked`/`voice:moved`
e `app:update`, `toggleFullscreen` na ponte). Se divergirem de novo, o código
manda.

## O que continua congelado (não mexa)

- Nomes de todos os eventos de socket (o app 3.x instalado ainda os usa).
- Formato de `data/db.json` e da linha `app_state`.
- Chaves do `localStorage` com prefixo `dsx:` (e a migração do antigo `d2:`).
- `usernames` com a chave em minúsculas.
- Nomes das ferramentas de anotação em português (`'caneta'`, `'marcador'`,
  `'seta'`) — eles viajam no fio.
