# Desktop (Electron), empacotamento e CI/CD

## Por que `app://` e não `file://`

`desktop/app-protocol.js` registra um esquema próprio, `app://local`.

O problema: o bundle usa módulos ES (`<script type="module">`) e o Chromium
**recusa carregar módulo de `file://`** — origem opaca, busca de módulo sujeita
a CORS. A janela abriria em branco com um erro de CORS e nenhuma pista melhor.

A solução: `registerSchemesAsPrivileged` com `standard: true` (dá origem de
verdade, e com ela `localStorage` por origem) e `secure: true` (conta como
contexto seguro — `getUserMedia` e `getDisplayMedia` funcionam) sem afrouxar
`webSecurity`.

`registerScheme()` **precisa rodar antes de `app.whenReady()`**; `serve(root)`
depois. Há uma checagem de path traversal: sem ela,
`app://local/../../.ssh/id_rsa` leria qualquer arquivo da máquina.

Como o desktop carrega de `app://local` e o servidor está em outra origem,
`migrate-storage.js` traz sessão e preferências da origem `file://` antiga
uma vez, no primeiro boot da 4.0 (marcado por `storageMigrated` no config).

## `desktop/main.js` (616 linhas — a exceção à regra das 200)

Config em `%APPDATA%/DiSlackso/config.json`:

```js
{ mode, url, port, hardwareAcceleration, transparency, lastHostTunnel,
  devPasswordHash, serverUrlOverride, adminKey, storageMigrated, closeToTray }
```

Pontos que importam:

- `app.disableHardwareAcceleration()` tem de rodar **antes** de o app ficar
  pronto — por isso a leitura do config acontece no topo do módulo.
- **Instância única** (`requestSingleInstanceLock`); `second-instance` traz a
  janela existente para frente.
- **Fechar minimiza para a bandeja** (`closeToTray`, ligado por padrão): uma
  chamada em andamento não cai só porque a janela sumiu. Sair de verdade só
  pelo menu da bandeja (`isQuitting = true`).
- Links externos vão para o navegador do sistema (`setWindowOpenHandler` →
  `deny` + `shell.openExternal`).
- `titleBarStyle: 'hidden'` + `titleBarOverlay` — a barra de título é o
  componente `TitleBar` do React.
- Atalhos do processo principal: `F12`/`Ctrl+Shift+I` (DevTools),
  `Ctrl+R` (reload), `Ctrl+Alt+Shift+D` (painel de dev). O `Shift+R` que
  reinicia o app está no **renderer** (`useKeyboardShortcuts`).

### Seletor de tela

`session.setDisplayMediaRequestHandler` com `useSystemPicker: false`:
`desktopCapturer.getSources()` → manda a lista (com miniaturas e ícones) pelo
IPC `screen:pick` → o preload repassa ao `screenPicker` registrado por
`useScreenPickerBridge` → `useScreenPicker` store segura a Promise até a modal
responder → `screen:picked`.

Timeout de 120 s para não pendurar a Promise para sempre.

**Áudio do sistema (`audio: 'loopback'`) só entra quando a fonte é uma tela
inteira** (`source.id.startsWith('screen:')`), no Windows ou Linux. Pedir
loopback ao capturar uma janela específica falha com "Could not start audio
source" — limitação do WASAPI loopback, que não sabe isolar o som de uma
janela. `screen:retryNoAudio` marca `forceNoAudioNext` para repetir a **mesma**
fonte sem áudio, sem reabrir o seletor.

### Atualizador (`electron-updater`)

- `autoDownload = false`, `autoInstallOnAppQuit = false`. **Nada acontece sem
  o usuário mandar**: pergunta antes de baixar e antes de reiniciar.
- Lê `latest.yml` (Windows) / `latest-linux.yml` (Linux) publicados pelo
  `electron-builder` no Release. O download aproveita o `.blockmap` e traz só
  os pedaços que mudaram.
- `updateCapability()` bloqueia em dois casos: rodando do código-fonte
  (`!app.isPackaged`, salvo `DISLACKSO_DEV_UPDATE`) e **build portátil**
  (detectado pelo marcador `resources/PORTABLE`) — não há instalador para rodar.
- Erros crus do updater são traduzidos para texto humano; o 404 é tratado como
  "repositório privado", porque o GitHub responde 404 em vez de 403 para não
  revelar que o repo existe. **O repositório precisa ser público**: o
  atualizador roda sem autenticação na máquina dos usuários.
- Estado empurrado ao renderer por `update:state`; a UI é
  `settings/sections/UpdatesSection.tsx` + `UpdateCheckModal.tsx` +
  `hooks/useUpdater.ts`.

### Painel de desenvolvedor

`Ctrl+Alt+Shift+D` → janela própria (`dev-window.html` + `dev-preload.js`),
protegida por senha (`scrypt`, padrão `dislackso-dev`, trocável na própria
janela). Preload isolado: os handlers `dev:*` chamam `requireDevAuth()` antes
de qualquer coisa.

O que dá para fazer lá: sobrescrever o servidor usado pelo app, ligar/desligar
aceleração de hardware e transparência, forçar checagem de atualização, abrir
a pasta de dados, limpar cache local, mandar comunicado para todo mundo
(precisa de `adminKey` batendo com `ADMIN_KEY` do Render) e marcar a conta
administradora do app.

### A ponte (`desktop/preload.js` → `window.desktop`)

```
isDesktop, getConfig, setConfig, info, restart, goHome, openExternal,
focusWindow, toggleFullscreen, onPickScreen, retryScreenShareWithoutAudio,
update.{ state, check, download, install, onChange }
```

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`. Tipada em
`src/lib/platform.ts` — no navegador `window.desktop` não existe e tudo degrada
para "não disponível" (`desktop()` devolve `null`; use sempre com `?.`).

## Empacotamento

| Comando | Saída | Observação |
|---|---|---|
| `npm run dist` | `release/DiSlackso-Setup-<ver>.exe` (+ `.blockmap`, `latest.yml`) | NSIS, não one-click, permite escolher pasta |
| `npm run portable` | `dist/DiSlackso-portable/` | pasta que roda direto, sem admin |
| `electron-builder --linux` | `release/*.AppImage`, `release/*.rpm` | precisa rodar em Linux (o `.rpm` depende de ferramentas nativas) |

> O `README.md` ainda diz `dist/DiSlackso-Setup-…exe` e sugere `npm run build`
> para gerar o instalador. Ambos estão velhos: `directories.output` é
> **`release/`** e `npm run build` hoje é só o bundle web.

### `scripts/prep-build.js` — o erro "Cannot create symbolic link"

O `electron-builder` baixa o `winCodeSign`, empacotado com bibliotecas macOS
gravadas como links simbólicos. Criar symlink no Windows exige privilégio que
conta comum não tem, e o build inteiro morre por causa de dois `.dylib` que um
build Windows nunca usa.

O script extrai o pacote ignorando esses dois links, **direto na pasta final
versionada** do cache
(`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`). A
pasta que aparece na mensagem de erro (`…\winCodeSign\242339159`) é temporária
e muda a cada tentativa — pré-extrair nela não adianta.

Não precisa de Modo Desenvolvedor nem admin. Em Linux o script detecta a
plataforma e não faz nada.

### `scripts/pack-portable.js`

Copia o `electron/dist`, resolve as dependências de produção caminhando pelos
`package.json` (o npm achata o `node_modules`) e **ignora links simbólicos** —
que é exatamente o que trava o build oficial. Grava o marcador
`resources/PORTABLE` que faz o atualizador se desativar.

## CI/CD (`.github/workflows/`)

### `ci-build.yml` — todo PR e push em `master`

Matriz Windows + Ubuntu, Node 22, `npm ci`, `npm run dist` (`--publish never`),
sobe os artefatos na execução do Actions (retenção 14 dias). **Nunca escreve em
lugar nenhum** — seguro para PRs vindos de forks. No Linux instala `rpm` e
`fakeroot` antes.

### `build-release.yml` — tag `v*` ou `workflow_dispatch`

1. Matriz Windows + Ubuntu, `electron-builder --publish always` → sobe
   instaladores + `latest.yml` / `latest-linux.yml` no Release da tag. O
   owner/repo de destino vem de `build.publish` no `package.json`
   (**`spikeleez/dislackso`** — não este fork).
2. Só no Windows: gera o `.zip` portátil e anexa (`continue-on-error` — é
   bônus, não pode travar o job).
3. Job `notify` (`needs: build`): chama `/api/admin/notify-update` para avisar
   quem está com o app aberto. **Depois** dos builds, de propósito: avisar
   antes deixaria quem clicasse em "atualizar" com um download quebrado.
   Precisa dos secrets `ADMIN_KEY` e, opcionalmente, `SERVER_URL`.

`permissions: contents: write` é necessário para o `electron-builder` criar/
editar o Release.

### `render-deploy.yml` — Release publicado

Dispara o deploy hook do Render (`secrets.RENDER_DEPLOY_HOOK_URL`). Sem o
secret, pula em silêncio sem ficar vermelho.

## Publicação na nuvem (`render.yaml`)

Serviço web Node no plano free: `npm ci && npm run build` / `npm start`,
health check em `/api/health`, Node 22. Variáveis: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_ROW_ID=main`, `TURN_*`, `ADMIN_KEY`.

Limites do free: Supabase pausa projetos após uma semana sem uso; o Render
adormece após 15 min sem tráfego e a primeira conexão pode levar ~1 min.

Passo a passo completo em [`../DEPLOY.md`](../DEPLOY.md).
