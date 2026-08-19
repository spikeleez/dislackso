# Armadilhas — o que quebra se for mexido sem cuidado

Lista de invariantes com o motivo. Cada item existe porque já foi (ou seria)
um bug real.

## Protocolo e persistência

**Nomes de evento de socket são congelados.** O app 3.x instalado nas máquinas
dos usuários fala exatamente estes nomes. Renomear qualquer um deles quebra
quem não atualizou. `src/lib/socket/events.ts` é o contrato do lado do
cliente; `server/socket/*.js` do lado do servidor.

**Chaves do `localStorage` (`dsx:`) são congeladas.** Renomear qualquer uma
desloga todo mundo e apaga servidores em cache. `src/lib/storage.ts` também
migra do prefixo antigo `d2:` no primeiro boot — não remova essa migração.

**`settings` não pode usar o middleware `persist` do Zustand.** Ele envelopa o
estado em `{ state, version }`; o 3.x gravou objeto plano em `dsx:settings`.
Trocar a serialização apaga as preferências de quem atualiza.

**Nomes das ferramentas de anotação estão em português no fio**
(`'caneta'`, `'marcador'`, `'seta'`). Traduzir quebra a compatibilidade entre
versões.

**`makePublicUser` recebe acessor, não objeto.** `store.restore()` substitui o
banco inteiro ao ler do Supabase; uma referência capturada apontaria para o
objeto velho e todo mundo viraria "Desconhecido" depois de um redeploy.

**`publicUser` / `publicGuild` são a única barreira de privacidade.**
`passwordHash` e `token` de terceiros não podem atravessar. Qualquer campo
novo em `user` é privado até ser explicitamente adicionado ali.

**Sem Supabase configurado, o disco do Render é efêmero.** Todo redeploy zera
os dados. `/api/health` expõe `supabase`, `supabaseError` e `supabaseLastOkAt`
exatamente para diagnosticar isso.

**`store.restore()` roda antes de `listen()`.** Aceitar conexões antes faria
os primeiros a entrar verem o banco vazio — e o primeiro `save()` sobrescrever
o estado remoto com esse vazio.

**O espelho Supabase tem duas travas que não saem dali** (`supabase.js`): não
grava sem antes ter LIDO o remoto, e não grava um banco sem usuários por cima
de um estado que já teve usuários. Elas existem porque um `load()` falhado num
redeploy + um `save()` do banco vazio já apagou as contas de todo mundo.
`restore()` insiste com backoff e, desistindo, segue tentando em background
(reconciliação por união de chaves uuid). Há flush síncrono no SIGTERM.

**Escrita é tmp + rename.** Escrever direto no `db.json` deixaria JSON truncado
numa queda no meio, ou seja, tudo perdido.

## Cliente

**`startConnection()` roda uma vez para a vida do app** (guarda `started`).
Chamar de novo registra os listeners em duplicata no socket singleton, e cada
evento do servidor aparece repetido.

**Nenhum componente fala com o socket direto.** `app/connection.ts` é o único
ouvinte de eventos push; componentes leem dos stores e chamam
`features/*/actions.ts`. Voltar a espalhar listeners é o emaranhado que o
refactor 4.0 removeu.

**`useMessages.append` deduplica por `message.id`.** O servidor devolve a
mensagem no ack de quem enviou **e** no evento `message:new`; sem a checagem,
o próprio autor vê tudo em dobro.

**Objetos de callback passados a hooks precisam ser estáveis.** Em `Shell.tsx`,
`openAccountSettings` é `useCallback` porque um objeto novo a cada render
desligaria e religaria os atalhos de teclado. Em `Tile.tsx`, `getVideo`/
`getRoot` são `useCallback` porque, sem isso, o cleanup do `AnnotationLayer`
desliga o modo caneta no instante seguinte a ele ser ligado.

**A troca entre `Gate` e `Shell` é remoção direta, sem `AnimatePresence`.** Se
a animação de saída do Gate não completa, ele fica preso por cima — visível,
cobrindo o app e engolindo todo clique.

**`PeerAudio` mora no `Stage`, nunca dentro do `VoiceStage`.** Abrir um canal
de texto por cima da sala desmonta o VoiceStage — e desmontar o PeerAudio
remove os `<audio>` do DOM: você para de ouvir todo mundo enquanto todos
continuam te ouvindo. O áudio só pode depender de "estou na sala".

**O stream do `<video>` do Tile é ligado por callback ref, não por efeito.**
Entrar/sair da tela cheia troca a árvore (portal ↔ inline): o React recria o
elemento sem remontar o componente, e um `useEffect` com deps `[stream, …]`
não roda de novo — o vídeo novo nasceria preto. Foi o bug da tela cheia preta.

**O Tile precisa de `size-full`, e cada célula da fita é `grid`.** Num flex, o
tile colapsava para a altura do conteúdo — o "amassado com espaço sobrando" da
fita de participantes.

**Nunca misture o atalho `background` com `backgroundImage` num style de
React.** Limpar o atalho (`style.background = ''`) reseta todas as
sub-propriedades, inclusive o `backgroundImage` definido na mesma atualização
— era o avatar/banner invisível na tela de conta. Use `backgroundColor`.

**`overflow-hidden` só no container mais externo do `VoiceStage`.** Repetir
nos internos corta o topo dos avatares numa grade baixa.

**Tela cheia precisa de `createPortal(tile, document.body)`.** `position:
fixed` sozinho não basta: ancestral com `backdrop-filter` cria contexto de
empilhamento próprio e prende o `z-index`.

**O container do tile destacado é `grid`, não `div`.** Um bloco comum não
estica o Tile e o `<video>` cai para a altura intrínseca.

**`applySettings()` roda antes do primeiro render** (`main.tsx`). Sem isso o
app pisca no tema padrão.

## WebRTC

**Não amarre o motor ao React.** `src/lib/rtc/` é imperativo de propósito; a
única ponte é `useEngineBridge` → `useRoom.bump()`. Um `useEffect` que
recriasse conexões a cada render derrubaria a chamada.

**Sinais que chegam antes do par existir vão para `pending`** (TTL 30 s).
Descartá-los trava a conexão em `new` para sempre — abrir o microfone leva
tempo e pode falhar.

**`polite` tem de ser oposto nos dois lados** (`host.sid > sid`). Se os dois
forem polite ou os dois impolite, o handshake trava numa colisão de ofertas.

**Se nenhum lado tem faixa para enviar, nada dispara a negociação.** Por isso
`host.sid <= sid` adiciona `addTransceiver('audio', { direction: 'recvonly' })`.

**Sem `maxBitrate` explícito o Chrome trava perto de 2,5 Mbps** — os presets de
qualidade viram decoração.

**`degradationPreference: 'maintain-resolution'` é o inverso do padrão.**
Reverter faz a tela borrar sob pressão de banda, que é o pior resultado
possível para código e texto.

**Opus precisa de `stereo=1` e `usedtx=0` reescritos no SDP.** O padrão do
WebRTC é mono com DTX, que corta o começo das palavras e estraga música e
áudio de jogo.

**`tuneOpus` funde com o `fmtp` existente**, não sobrescreve a linha.

**A tela não vai para ninguém sem `watch`.** Publicar automaticamente em
1080p60 para quatro pessoas são 32 Mbps de subida.

**`watch`/`unwatch` são interceptados em `Peer.handleSignal` antes do
negociador.** Eles trafegam pelo canal `rtc:signal` mas não são SDP nem ICE.

**Queda automática só reage a `qualityLimitationReason === 'bandwidth'`.**
Reagir a `cpu` puniria o usuário por um problema que se resolve fechando outro
programa.

**Trocar de microfone é `replaceTrack`, não renegociação.** Renegociar com a
sala inteira derruba a conexão de todo mundo por um instante.

**Mudo e ensurdecido são preferências persistentes** (`micMuted`/`soundOff` em
`stores/settings`). Entrar numa sala respeita como eles estavam; `voice.stop()`
não zera mais o `deafened`. Os botões na CallBar valem fora de chamada — lá
eles ajustam a preferência salva, e o motor a adota no próximo `start()`.

**RNNoise e `noiseSuppression` nativo não convivem** — quando um está ligado, o
outro é desligado em `MicGraph.open()`.

**`SPEAKING_HANGOVER_MS` existe por um motivo.** Fala normal cruza o limiar
dezenas de vezes por segundo nas micropausas; sem o hangover o anel verde
pisca sem parar.

**`window.blur` tem de soltar o PTT.** Senão o microfone fica aberto com a
pessoa em outro programa.

## Desktop

**`registerScheme()` antes de `app.whenReady()`.** Depois disso o Chromium já
decidiu quais esquemas são privilegiados, e a chamada não faz efeito.

**O bundle carrega por `app://`, não `file://`.** Módulos ES não carregam de
`file://` — janela em branco com erro de CORS.

**`app.disableHardwareAcceleration()` antes de o app ficar pronto.** Por isso a
leitura do config está no topo do módulo, não dentro de `whenReady`.

**Áudio de sistema (`loopback`) só com tela inteira**, no Windows/Linux. Pedir
loopback ao capturar uma janela específica falha com "Could not start audio
source" — limitação do WASAPI, não bug do app.

**O repositório precisa ser público para a auto-atualização funcionar.** O
atualizador roda sem autenticação na máquina dos usuários e o GitHub responde
404 em repositório privado. Embutir token exporia o segredo a quem tiver o
`.exe`.

**A versão portátil não se atualiza.** Detectada pelo marcador
`resources/PORTABLE`; `updateCapability()` bloqueia e a UI leva o usuário até a
página de releases.

**`latest.yml` / `latest-linux.yml` são obrigatórios no Release.** Sem eles os
apps instalados não enxergam a versão nova.

**`build.publish` aponta para `spikeleez/dislackso`.** Um
`electron-builder --publish always` rodado deste fork tentaria escrever no
upstream.

**O aviso de versão nova só é disparado depois dos builds** (`needs: build` no
workflow). Antes disso, quem clicasse em "atualizar" pegaria download quebrado.

**`prep-build.js` mira a pasta versionada do cache**
(`winCodeSign-2.6.0`), não a temporária que aparece na mensagem de erro
(`…\winCodeSign\242339159`), que muda a cada tentativa.

## Servidor

**`guild:delete` emite `guild:deleted` antes de apagar.** Depois não há mais
sala para emitir.

**No `disconnect`, apague a sessão antes de recalcular `pushOnline`.** Senão o
usuário some da lista mesmo tendo outra aba aberta.

**`rtc:signal` só repassa entre sockets da mesma sala.** É a única validação
que impede um cliente de injetar sinais em conversas alheias.

**`cleanAssetPath` recusa `data:` URLs.** Um avatar de alguns MB embutido em
`user.avatar` viajaria inteiro em cada mensagem de socket que incluísse esse
usuário e estouraria o `maxHttpBufferSize`.

**`cleanAssetPath` devolve `undefined` para inválido, `''` para apagar.** O
chamador precisa distinguir os dois — senão um caminho torto apagaria a imagem
que a pessoa já tinha.

**CORS em `/api` é obrigatório.** O desktop chama de `app://local`; sem o
middleware o preflight morre e uploads falham em silêncio.

**Histórico é limitado a 200 no disco / 100 na resposta.** O banco inteiro é
carregado na memória a cada boot.

**Criar canal é ação do dono desde esta rodada** (era de qualquer membro até a
4.0.3). `guild:kick` e `voice:move` também são só-dono/admin; o `voice:move`
não mexe nas salas do socket — avisa o cliente (`voice:moved`) e ele refaz o
join, para a malha de mídia desmontar pelo caminho normal.

**Imagens são reduzidas no cliente antes do upload** (`shrinkImage` em
`features/profile/actions.ts`; GIF passa direto). Elas moram dentro do banco e
o banco inteiro é espelhado a cada save — sem o shrink, o payload do espelho
crescia até o Supabase recusar.

## Documentação

`docs/CONTRATO.md` e `README.md` foram atualizados nesta rodada e refletem o
código — se divergirem de novo, o código manda.
