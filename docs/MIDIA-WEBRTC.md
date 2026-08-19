# O motor de mídia (`src/lib/rtc/`)

A parte mais delicada do projeto. Vive **fora do React** de propósito: WebRTC é
uma máquina de estados cheia de callbacks, e amarrá-la ao ciclo de render só
produziria reconexões a cada repintura. A comunicação com a interface é por
`Emitter` tipado (`lib/emitter.ts` + `rtc/events.ts`).

## As peças

```
VoiceEngine (engine.ts)          instância única exportada como `voice`
 ├── quality : QualityControl    qual preset vale agora e quando descer
 ├── mic     : MicGraph          grafo Web Audio do microfone
 ├── mesh    : PeerMesh          ciclo de vida das conexões
 │     └── Peer (peer.ts)        uma RTCPeerConnection por participante
 │           ├── Negotiator      aperto de mão (perfect negotiation)
 │           ├── InboundStreams  o que chega
 │           └── OutboundTracks  o que sai
 └── screen  : ScreenSharing     captura, prévia, vigilância de congestão
       ├── PreviewLoop           miniatura estática por socket
       └── CongestionWatch       FPS real vs anunciado
```

O `VoiceEngine` expõe as peças direto (`voice.mic`, `voice.mesh`,
`voice.screen`, `voice.quality`) em vez de escondê-las atrás de métodos que só
repassam chamada. O que fica no motor é o que atravessa todas: entrar/sair da
sala, mudo, ensurdecer, trocar microfone, publicar estado.

## Malha completa (mesh), não SFU

Cada pessoa mantém uma `RTCPeerConnection` com **cada uma** das outras. O
servidor só apresenta os dois lados e repassa SDP/ICE.

Custo: em 1080p60 (8 Mbps) transmitindo para 3 amigos você envia
**8 Mbps para cada um** = 24 Mbps de subida. Acima de ~5 pessoas transmitindo
ao mesmo tempo o caminho seria um SFU. Isso é uma decisão consciente, não uma
pendência — o público-alvo é um grupo pequeno.

## A assimetria que salva a banda

**O microfone vai para todo mundo assim que a conexão abre. A tela não.**

Quem transmite publica só uma **miniatura estática** (`screen:preview`,
data URL, máx. 200 000 chars) pelo socket. Quem quer ver de verdade clica em
"Assistir transmissão" → `watchPeer(sid)` → `Peer.send({ watch: true })`.

`watch` / `unwatch` reaproveitam o canal `rtc:signal` em vez de inventar um
evento de socket novo — por isso são interceptados em `Peer.handleSignal()`
antes de chegarem ao negociador:

```ts
if ('watch' in signal)   { if (localScreen) this.addScreen(localScreen); return; }
if ('unwatch' in signal) { this.removeScreen(); return; }
```

Em 1080p60 para quatro pessoas, a diferença é entre 32 Mbps de subida e quase
nada.

## Negociação perfeita (`negotiation.ts`)

Os dois lados podem começar a transmitir ao mesmo tempo. O padrão *perfect
negotiation* resolve a colisão: um lado é **polite** e recua.

```ts
polite: host.sid > sid   // comparação de ids: exatamente um dos dois é polite
```

- `applyDescription()` detecta colisão (`offer` chegando enquanto
  `makingOffer` ou `signalingState !== 'stable'`). O impolite ignora; o polite
  aceita (com rollback implícito do `setRemoteDescription`).
- Sinais são **enfileirados** (`chain: Promise<void>`) porque a aplicação é
  assíncrona e a ordem importa.
- Uma oferta que chega **antes do par existir localmente** não é descartada:
  `PeerMesh.handleSignal` guarda em `pending` com TTL de 30 s. Abrir o
  microfone leva tempo (e pode falhar); jogar fora esses sinais travaria a
  conexão em `new` para sempre.
- Se nenhum dos dois tem faixa para enviar, nada dispara a negociação — por
  isso o lado "impaciente" (`host.sid <= sid`) adiciona um
  `addTransceiver('audio', { direction: 'recvonly' })`.

## Ajustes de SDP e encoder (`sdp.ts`)

Cada um corrige um padrão do WebRTC que, deixado como está, degrada de forma
visível:

| Ajuste | Padrão do navegador | O que fazemos | Por quê |
|---|---|---|---|
| Codec de vídeo | VP8 costuma ganhar | ordem `VP9 → H264 → AV1 → VP8` via `setCodecPreferences` | VP9 lê muito melhor texto e UI parada |
| `degradationPreference` | derruba resolução sob pressão | `'maintain-resolution'` | para código e texto, borrar é pior que perder FPS |
| `maxBitrate` / `maxFramerate` | implícito | explícito, do preset | sem isso o Chrome trava perto de 2,5 Mbps |
| `contentHint` | ausente | `'motion'` ou `'detail'` | diz ao codificador se é jogo ou texto parado |
| Opus | mono, com DTX | `stereo=1`, `sprop-stereo=1`, `usedtx=0`, `maxaveragebitrate` do preset, `useinbandfec=1` | mono com DTX corta o começo das palavras e estraga música/áudio de jogo |
| Prioridade | normal | `networkPriority`/`priority` = `'high'` | disputa de banda com o resto da máquina |

`tuneOpus()` **funde** com os parâmetros `fmtp` existentes em vez de
sobrescrever a linha inteira.

## Presets de qualidade (`quality.ts`)

| Chave | Label | Resolução | FPS | Vídeo | Áudio |
|---|---|---|---|---|---|
| `720p30` | 720p 30fps | 1280×720 | 30 | 2,5 Mbps | 128 kbps |
| `1080p30` | 1080p 30fps | 1920×1080 | 30 | 4,5 Mbps | 192 kbps |
| **`1080p60`** | 1080p 60fps | 1920×1080 | 60 | **8 Mbps** | 256 kbps |
| `1440p60` | 1440p 60fps | 2560×1440 | 60 | 12 Mbps | 256 kbps |
| `4k30` | 4K 30fps | 3840×2160 | 30 | 16 Mbps | 256 kbps |

Padrão: `1080p60`. Microfone tem bitrate próprio e fixo: `MIC_BITRATE = 96 kbps`
(`outbound.ts`) — a voz não precisa de mais, e o resto da banda é da tela.

**Escada de queda** (`QUALITY_LADDER`, do mais pesado ao mais leve):
`4k30 → 1440p60 → 1080p60 → 1080p30 → 720p30`.

### Queda automática (`congestion.ts`)

A cada 4 s, `CongestionWatch` lê `getStats()` de todos os pares e olha
`outbound-rtp` de vídeo:

- se o **FPS real** cai abaixo de 40 % do alvo (`FPS_FLOOR_RATIO`)
- **e** o navegador diz `qualityLimitationReason === 'bandwidth'`
- por 3 medições seguidas (`STRIKES_TO_DOWNGRADE`)

→ desce um degrau e avisa o usuário do que aconteceu.

Limitação por **CPU é ignorada** de propósito: resolve-se fechando outro
programa, e derrubar a qualidade puniria o usuário por um problema que não é
de rede.

## Captura de tela (`screen.ts`)

`captureScreen()` tem três redes de segurança, cada uma originada de um bug
real em produção:

1. **Hints não padronizados rejeitados** (`TypeError` / `OverconstrainedError`):
   versões de Chromium/Electron recusam `systemAudio`, `surfaceSwitching`,
   `selfBrowserSurface`, `restrictOwnAudio`. Segunda tentativa usa o pedido
   mínimo `{ video: true, audio: true }`.
2. **"Could not start audio source" no Windows**: driver recusando loopback.
   Chama `desktop().retryScreenShareWithoutAudio()`, que faz o processo
   principal repetir a **mesma fonte já escolhida** sem áudio — sem reabrir o
   seletor na cara do usuário.
3. **Captura sem faixa de áudio nenhuma** é normal, mas ganha explicação em
   texto — senão parece que o app quebrou.

Depois de capturar: aplica `contentHint`, reforça as constraints com
`applyConstraints` (no Electron a captura vem do `desktopCapturer` e ignora
parte das constraints iniciais), e marca faixas de áudio como
`contentHint = 'music'`.

Parar pela barra do navegador/sistema dispara `ended` na faixa de vídeo →
`ScreenSharing.stop()`.

## Microfone (`mic.ts`)

Grafo Web Audio: `fonte → [RNNoise] → ganho → destino` (+ `analyser` derivado
do ganho).

Não é firula — o grafo é o que permite quatro coisas que a faixa crua não dá:

1. supressão de ruído com IA (RNNoise via AudioWorklet + WASM,
   `static/rnnoise/`);
2. volume de entrada ajustável (`micGain`, 0..3);
3. medidor de voz — o "está falando" que acende o avatar;
4. trocar de aparelho com `replaceTrack`, **sem renegociar SDP** com a sala
   inteira.

Detalhes:

- `enabled` (o que o usuário escolheu) ≠ `isOpen()` (está passando áudio
  agora). No modo *apertar para falar*, `isOpen()` também exige `pttHeld`.
- `SPEAKING_THRESHOLD = 12` (0..255, média do espectro) e
  `SPEAKING_HANGOVER_MS = 400`. O hangover existe porque fala normal cruza o
  limiar dezenas de vezes por segundo nas micropausas entre sílabas — sem ele
  o anel verde piscava sem parar.
- Se o aparelho escolhido sumiu (headset USB removido), `open()` limpa
  `micId` e tenta de novo com o padrão do sistema.
- Entrar na sala respeita as preferências persistentes `micMuted`/`soundOff`
  (ver `stores/settings`): quem saiu pra falar entra falando, quem se mutou
  entra mudo. `toggleMic`/`toggleDeafen` funcionam fora de sala (ajustam só a
  preferência) e gravam a escolha quando em sala.
- Quando `rnnoise` está ligado, `noiseSuppression` nativo é desligado (os dois
  juntos brigam).

## O que chega (`inbound.ts`)

Um par pode mandar dois streams (microfone e tela) e eles chegam em ordem
imprevisível. Quem manda anuncia os ids em `voice:state`, mas **a mídia
costuma chegar antes do anúncio** — por isso cada busca tem palpite de
reserva:

- `screen(state)`: id anunciado → senão, o primeiro stream com faixa de vídeo.
- `mic(state)`: id anunciado → senão, o primeiro stream **sem** vídeo e com
  áudio.

## Conexão travada

`STUCK_WARNING_MS = 20 s`. Se o par não conectou até lá, o app avisa em texto
que a rede provavelmente bloqueia conexão direta (CGNAT / NAT simétrico, comum
em internet via rádio e 4G/5G) e sugere TURN próprio.

Em `failed`, chama `restartIce()`.

## ICE (`server/ice.js`)

Entregue no payload de sessão (`iceServers`):

- STUN: `stun.l.google.com:19302`, `stun1.l.google.com:19302`,
  `stun.cloudflare.com:3478`;
- TURN público **Open Relay** (`openrelay.metered.ca` nas portas 80, 443 e
  443/TCP) — best-effort, sem garantia, mas cobre CGNAT sem configuração;
- TURN próprio se `TURN_URL` / `TURN_USER` / `TURN_PASS` estiverem no ambiente
  (aceita lista separada por vírgula).

## Estado publicado

`voice:state` carrega `{ mic, screen, speaking, annot, streams: { mic, screen } }`.
O servidor sanitiza: booleanos coeridos, `annot` default `true`, ids de stream
cortados em 128 chars.

`useStageEntries.ts` separa dois conceitos que parecem um só:

- `intendsScreen` — a pessoa **anunciou** que transmite;
- `sharing` — dá para exibir vídeo **agora**.

A mídia chega alguns instantes depois do aviso; o destaque precisa sobreviver
a essa janela, por isso são dois campos. `resolveFocus()` só desiste do
destaque quando a pessoa saiu ou parou de transmitir de fato.
