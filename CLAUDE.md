# CLAUDE.md — briefing operacional do DiSlackso

> Leia isto primeiro. A documentação profunda está em [`docs/`](docs/README.md) —
> **não re-estude o projeto do zero**, os documentos lá já mapeiam tudo.

## O que é

App tipo Discord para um grupo de amigos: servidores privados, salas de voz,
canais de texto, **compartilhamento de tela em alta resolução** (até 4K) e
anotação ao vivo por cima da transmissão.

Vídeo e áudio vão **P2P via WebRTC** — o servidor só faz sinalização, guarda
estado (perfis/servidores/mensagens) e repassa traços de anotação. Ele nunca vê
mídia.

Um código-fonte, **dois empacotamentos**: `dist/web` (servido pelo Express) e
`dist/desktop` (carregado pelo Electron via `app://`).

- Versão atual: **4.0.3** (`package.json`)
- Idioma do projeto: **português (pt-BR)** — código, comentários, UI, commits,
  PRs e docs. Escreva em português.

## Fork e Pull Requests — leia antes de commitar

Este repositório é um **fork**:

| | |
|---|---|
| origin (este repo) | `git@github.com:tornellihenrique/dislackso.git` |
| upstream (destino dos PRs) | `https://github.com/spikeleez/dislackso.git` |
| branch principal | `master` (nos dois) |

**O trabalho vira PR para `spikeleez/dislackso`.** O mantenedor aceita
receber a documentação interna (`CLAUDE.md`, `docs/*`) no upstream, então
branch de trabalho pode sair do `master` local normalmente:

```bash
git checkout master && git fetch upstream && git merge upstream/master
git checkout -b feat/nome-curto
# ... alterações ...
npm run typecheck && npm run build
git commit
git push -u origin feat/nome-curto
gh pr create --repo spikeleez/dislackso --base master --head tornellihenrique:feat/nome-curto
```

Antes de abrir o PR, confira o que vai nele:
`git log --oneline upstream/master..HEAD`.

Nunca commite direto em `master` sem o usuário pedir. Nunca faça push nem abra
PR sem confirmação — PR é ação externa e irreversível na prática.

## Comandos

```bash
npm install

npm run dev          # interface no Vite (5173), com proxy para a API
npm run server       # API/socket na 3000   (alias: npm start)
npm run build        # -> dist/web     (modo web, base '/')
npm run build:desktop# -> dist/desktop (modo desktop, base './')
npm run desktop      # build:desktop + electron .
npm run typecheck    # tsc --noEmit  <- ÚNICO portão automático do projeto
npm run dist         # icon + build:desktop + prep-build + electron-builder -> release/
npm run portable     # -> dist/DiSlackso-portable/  (Windows, sem instalador)
npm run cert         # certificado autoassinado -> HTTPS local
npm run icon         # gera build/icon.ico e build/icon.png
```

Desenvolvimento normal = dois terminais: `npm run server` + `npm run dev`.

**Não há ESLint, Prettier nem framework de teste.** O único teste é
`node scripts/test-channel-delete.js` (rodado à mão). Antes de entregar
qualquer coisa: `npm run typecheck` **e** `npm run build`. Ambos passam
limpos hoje — se quebrarem, foi você.

## Mapa rápido

```
src/app/          raiz React, ponte com socket / motor de mídia / Electron
src/components/   ui, layout, stage, chat, members, settings, annotate, overlays
src/features/     ações por assunto (auth, guilds, messages, profile, voice)
src/stores/       Zustand (session, guilds, room, messages, settings, toasts…)
src/lib/rtc/      motor de mídia (WebRTC) — a parte mais delicada do projeto
src/lib/annot/    anotação: geometria, desenho, envio
src/lib/socket/   cliente tipado; events.ts é o contrato com o servidor
src/styles/       tokens, temas, vidro líquido, movimento

server/           CommonJS: db (json + espelho Supabase), http, socket handlers
server.js         sobe o servidor sozinho (modo navegador)
desktop/          Electron: main, preload, protocolo app://, janela de dev
scripts/          cert, ícones, empacotamento portátil, prep do winCodeSign
.github/workflows CI de PR, build+publish de release, deploy do Render
```

## Regras que não se quebram

1. **O protocolo é congelado.** Apps 3.x instalados ainda falam os mesmos
   eventos. Nomes de evento, formato do banco e chaves do `localStorage`
   (`dsx:`) não se renomeiam — ver [`docs/CONTRATO.md`](docs/CONTRATO.md) e
   [`docs/ARMADILHAS.md`](docs/ARMADILHAS.md).
2. **`publicUser` / `publicGuild` são a barreira de privacidade.**
   `passwordHash` e `token` de terceiros nunca atravessam essas funções.
3. **Nenhum arquivo passa de ~200 linhas.** Não é estética: é o que faz mexer
   numa parte não exigir ler o resto. Se um arquivo cresce, ele se divide.
4. **A tela não vai para ninguém sem pedido.** Todos recebem uma miniatura
   leve; só quem clica em "assistir" recebe o vídeo (`watch`/`unwatch`).
5. **O motor de mídia (`src/lib/rtc/`) vive fora do React.** A única ponte é
   `useEngineBridge` → `useRoom.bump()`. Não amarre WebRTC a ciclo de render.
6. **`app/connection.ts` é o único lugar que escuta eventos do servidor.**
   Componentes leem dos stores; nenhum fala com o socket direto.
7. **Ícones são SVG inline do Lucide** (24×24, traço 2, `currentColor`).
   Nunca emoji — a UI já sofreu com desalinhamento por causa disso.
8. **Cor, raio, tempo e vidro vêm de tokens CSS.** Nada de valor cru em
   componente; trocar de tema é trocar variável.

## Convenções de código

- **Cliente**: TypeScript ESM, `strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax` (use `import type`), alias `@/*` → `src/*`.
- **Servidor e Electron**: CommonJS (`'use strict'`, `require`), sem
  TypeScript. Não converta — é o que mantém o empacotamento simples.
- **Comentários explicam *por quê*, não *o quê*.** O repositório inteiro segue
  isso: quase todo bloco não óbvio tem um parágrafo dizendo qual bug real ele
  evita. Mantenha o padrão — e o tom (direto, sem hype).
- Componentes React: função nomeada exportada, props tipadas em `interface`
  logo acima, Tailwind v4 via `cn()` (`clsx` + `tailwind-merge`).
- Commits em português, prefixo estilo conventional quando couber:
  `feat(escopo): …`, `fix(ci): …`, `build(linux): …`. Também há commits em
  frase corrida ("Sobe versão para 4.0.3: …") para releases.

## Onde esbarrar em cuidado

- `src/lib/rtc/` — negociação perfeita, presets de qualidade, SDP tunado.
  Leia [`docs/MIDIA-WEBRTC.md`](docs/MIDIA-WEBRTC.md) antes de mexer.
- `server/db/store.js` + `supabase.js` — no Render o disco é efêmero; sem o
  espelho no Supabase todo redeploy zera os dados.
- `desktop/main.js` — 616 linhas, o maior arquivo do projeto (exceção
  consciente à regra das 200).
- `docs/CONTRATO.md` e `README.md` foram atualizados na rodada de agosto/2026
  e refletem o código. Ao mexer no protocolo, atualize o CONTRATO junto —
  evento novo pode; renomear/mudar forma de existente, não.

## Nota sobre estes arquivos

`CLAUDE.md` e `docs/*.md` são versionados e podem ir para o upstream (o
mantenedor topou). A regra `*.md` que os ignorava foi removida do
`.gitignore` — era ela que obrigava `README.md`, `DEPLOY.md`,
`release_notes.md` e `docs/CONTRATO.md` a entrarem com `git add -f`.

Ao mudar comportamento do app, atualize os docs afetados no MESMO commit —
eles só valem enquanto refletem o código.
