# Arquitetura

## As três formas do app

Um código-fonte, três jeitos de rodar:

| Forma | Como sobe | Interface | Fala com |
|---|---|---|---|
| Navegador | `npm start` → Express na 3000 | `dist/web` (base `/`) | mesma origem |
| Desenvolvimento | `npm run server` + `npm run dev` | Vite na 5173 com proxy | `localhost:3000` |
| App de PC | `npm run desktop` → Electron | `dist/desktop` (base `./`) via `app://local` | `https://dislackso.onrender.com` (ou override) |

Quem decide isso é `src/lib/env.ts` → `serverUrl()`, nesta ordem de
prioridade:

1. override do painel de desenvolvedor (`setServerUrlOverride`);
2. `window.ENV.SERVER_URL` injetado por `<script>` na página (escape hatch do
   3.x, mantido para não quebrar instalações antigas);
3. `__DESKTOP_BUILD__ ? 'https://dislackso.onrender.com' : ''` (string vazia =
   mesma origem).

O `vite.config.mts` faz os dois builds pela flag `--mode`; `__DESKTOP_BUILD__`
e `__APP_VERSION__` entram por `define`.

## Camadas do cliente

```
                    ┌──────────────────────────────────────┐
   servidor ───────►│ app/connection.ts                    │  ÚNICO ouvinte
   (socket.io)      │  socket.on(...) → stores / motores   │  de eventos push
                    └───────────┬──────────────────────────┘
                                │
             ┌──────────────────┼───────────────────────┐
             ▼                  ▼                       ▼
      ┌────────────┐    ┌───────────────┐      ┌────────────────┐
      │  stores/   │    │ lib/rtc/      │      │ lib/annot/     │
      │  Zustand   │    │ VoiceEngine   │      │ AnnotEngine    │
      │ (reativo)  │    │ (imperativo)  │      │ (imperativo)   │
      └─────┬──────┘    └───────┬───────┘      └───────┬────────┘
            │                   │ Emitter              │ onChange
            │                   ▼                      │
            │           app/useEngineBridge.ts ◄───────┘
            │                   │ useRoom.bump()
            ▼                   ▼
      ┌──────────────────────────────────────┐
      │ components/  (React, só leem stores) │
      └──────────────┬───────────────────────┘
                     │ chamam
                     ▼
      ┌──────────────────────────────────────┐
      │ features/*/actions.ts → ask()/tell()│──► servidor
      └──────────────────────────────────────┘
```

Três regras que sustentam isso:

- **`app/connection.ts` roda uma vez para a vida do app** (guarda `started`).
  Chamar de novo registraria os listeners em duplicata no socket singleton, e
  cada mensagem apareceria duas vezes.
- **Componentes nunca falam com o socket.** Eles chamam `features/*/actions.ts`,
  que chamam `ask()` (com resposta, vira Promise) ou `tell()` (sem resposta).
- **O motor de mídia não é reativo.** Ele emite eventos; `useEngineBridge`
  traduz cada um em `useRoom.getState().bump()`, que incrementa `tick` e faz
  repintar quem lê do motor.

### `ask` vs `tell` (`src/lib/socket/client.ts`)

`ask(evento, payload)` só aceita eventos cuja assinatura em `ClientEvents` tem
callback — isso é imposto pelo tipo `AskableEvent`. Converte `{ error }` em
exceção, com timeout de 20 s. `tell` é disparo cego, para `voice:state`,
`rtc:signal`, `annot:*` e `screen:preview`.

`connectSocket()` usa `transports: ['websocket', 'polling']` **e**
`tryAllTransports: true` — sem o segundo, rede que bloqueia WebSocket (escola,
empresa) deixa o app preso na tela de entrada sem explicação.

## Stores (Zustand, `src/stores/`)

| Store | Guarda | Persiste em `localStorage`? |
|---|---|---|
| `session` | `phase`, `me`, `friends`, `isAdmin`, `connected`, `rejoin` | sim (`profileCache`, `friendsCache`, `userId`, `authToken`, `name`) |
| `guilds` | servidores, servidor/canal ativos, `presence`, `online` | sim (`guildsCache`) |
| `room` | sala atual, `focusId`, `watching`, `previews`, mudos locais, `fullscreenId`, `tick` | não |
| `messages` | `byChannel: Map<'guild/canal', ChatMessage[]>`, `unread` | não |
| `settings` | todas as preferências (`SettingsValues`) | sim (`settings`) |
| `toasts` | fila de avisos curtos (empilham, máx. 4) | não |
| `announcements` | fila de comunicados de admin | não |
| `screenPicker` | ponte da modal de escolha de tela do Electron | não |
| `updateAnnounce` | abre a modal de atualização a partir de um toast | não |

Detalhes que têm motivo:

- `presence` (quem está **nesta sala de voz**) e `online` (quem está **com o
  app aberto**) são separados de propósito: presença muda várias vezes por
  minuto (todo "está falando" é uma mudança) e online quase nunca. Juntos,
  a lista de membros repintaria a cada microfone aberto.
- `settings` persiste **à mão**, não com o middleware `persist`: o middleware
  envelopa em `{ state, version }` e o 3.x gravou objeto plano em
  `dsx:settings`. Manter o formato é o que preserva as preferências de quem
  atualiza.
- `phase` tem só três valores: `booting` (loading do `index.html` ainda na
  tela) → `gate` (login) → `ready` (app). `App.tsx` remove o `#boot` quando
  sai de `booting`.

## Fases do boot

1. `main.tsx` chama `applySettings()` **antes** do render — sem isso o app
   pisca no tema padrão.
2. `App` espera `useDesktopServerOverride()` resolver (no desktop, pergunta ao
   Electron se há servidor sobrescrito) e só então chama `startConnection()`.
3. `socket.on('connect')` → se há `userId` + `authToken` salvos, tenta
   `hello`; senão vai direto para `gate`.
4. `adoptSession(payload)` grava credenciais, popula `guilds`, configura o
   motor (`voice.configure(sid, iceServers)`), aplica qualidade e, se havia
   `rejoin` pendente, volta para a sala.
5. Rede de segurança: 8 s (`BOOT_TIMEOUT_MS`) sem resposta → cai para `gate`
   em vez de deixar o usuário preso no loading.

## Camadas do servidor (`server/`, CommonJS)

```
server.js                 entrada standalone (modo navegador)
  └─ server/index.js      createServer(): express + http/https + socket.io
       ├─ db/store.js     objeto em memória → arquivo (debounce 250 ms, tmp+rename)
       │   └─ db/supabase.js   espelho numa linha de app_state (opcional)
       ├─ db/shapes.js    defaultUser, normalizeChannel, publicUser, publicGuild
       ├─ ice.js          STUN público + Open Relay TURN + TURN próprio opcional
       ├─ http/cors.js    reflete a origem (o desktop chama de app://local)
       ├─ http/routes.js  /api/health, /api/upload, /api/image/:id, /api/admin/*
       └─ socket/
           ├─ index.js    junta os handlers; `guard()` vira exceção em { error }
           ├─ presence.js salas guild:<id> e voice:<guild>/<canal>, quem está onde
           ├─ auth.js     hello / register / login / claim
           ├─ profile.js  user:update, friend:add|remove
           ├─ guilds.js   guild:* e channel:*
           ├─ voice.js    voice:*, rtc:signal, screen:preview, annot:*
           └─ messages.js message:history, message:send
```

Cada handler recebe o mesmo `ctx` (`store`, `presence`, `publicUser`,
`publicGuild`, `iceServers`, `io`, `guard`) e não conhece os outros.

Detalhe importante: `makePublicUser` recebe um **acessor** (`() => store.data.users`),
não o objeto. `store.restore()` troca o banco inteiro ao ler do Supabase, e uma
referência capturada apontaria para o objeto velho — todo mundo viraria
"Desconhecido" depois de um redeploy.

## Fluxo de uma ação, ponta a ponta

Exemplo: alguém manda uma mensagem.

```
TextChannel (componente)
  → features/messages/actions.ts  sendMessage()
    → ask('message:send', { guildId, channelId, text })
      → server/socket/messages.js: valida acesso, limpa texto (2000 chars),
        guarda (mantém 200 no disco), emite 'message:new' para guild:<id>
        e responde no ack
    ← ack: { message }   → useMessages.append()  (dedup por id)
    ← evento 'message:new' → app/connection.ts → useMessages.append() (ignora,
      já tem o id) + feedback sonoro se o canal não estiver aberto
```

O `append` deduplica por `message.id` justamente porque a mensagem chega pelas
duas vias para quem enviou.

## Fluxo de uma sala de voz

```
joinVoice(guildId, channelId)
  → ask('voice:join')  →  servidor coloca o socket em voice:<g>/<c>,
                          devolve { peers } e avisa 'voice:peerJoined' aos outros
  → useRoom.enter()
  → voice.start()      →  abre o microfone (entra sempre mudo) e publica estado
  → para cada peer: voice.mesh.add(info)  →  new Peer(...)  →  RTCPeerConnection
      · quem tem sid menor abre a conversa (transceiver recvonly) se não houver faixa
      · onnegotiationneeded → Negotiator.offer() → 'rtc:signal'
      · servidor repassa cegamente para o destinatário da MESMA sala
  → voice.publishState()  →  'voice:state' para a sala
```

Ver [MIDIA-WEBRTC.md](MIDIA-WEBRTC.md) para o resto.

## Anotação

Traços viajam pelo **socket**, não pelo WebRTC: são poucos bytes (pontos
normalizados 0..1 relativos ao **quadro de vídeo**, não ao elemento) e assim
funcionam antes mesmo de a conexão P2P subir.

`AnnotEngine` (`src/lib/annot/engine.ts`) mantém uma camada por tile
registrado. O alvo `'local'` é a minha própria tela; no fio ele vira o meu
`sid`, porque para os outros eu sou só mais um participante — as funções
`wireTarget` / `localTarget` fazem essa tradução nos dois sentidos.

O laço de pintura é um `requestAnimationFrame` único que percorre todas as
camadas; traços com `fadeAlpha() === null` morreram de velho e são removidos.
DPR limitado a 2.
