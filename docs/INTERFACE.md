# Interface e design system

React 19 + TypeScript + Tailwind CSS v4 (plugin Vite, sem `tailwind.config`) +
Radix UI (primitivas acessíveis) + Motion (animação) + Lucide (ícones).

## Camadas de CSS (`src/styles/index.css`)

A ordem importa:

```css
@import 'tailwindcss';
@import './tokens.css';   /* define as variáveis */
@import './themes.css';   /* sobrescreve por tema */
@import './base.css';     /* reset, boot, scrollbar */
@import './glass.css';    /* vidro líquido */
@import './motion.css';   /* animações nomeadas */
```

### `tokens.css` — a fonte única de verdade visual

Bloco `@theme` do Tailwind v4. Todo componente se pinta a partir daqui;
**trocar de tema é trocar variável, nunca reescrever regra de componente.**

| Família | Exemplos |
|---|---|
| Superfícies | `--color-bg-0..4`, `--color-field`, `--color-tile` |
| Traço e texto | `--color-line`, `--color-line-strong`, `--color-hover`, `--color-active`, `--color-text`, `--color-dim`, `--color-bright` |
| Acento | `--color-accent`, `--color-accent-soft`, `--color-accent-fg` |
| Estados | `--color-green`, `--color-yellow`, `--color-red`, `--color-red-deep` |
| Raio | `--radius-scale` → `--radius-xs/sm/md/lg/xl/pill` |
| Tempo | `--speed` → `--duration-fast/med/slow`, `--ease-glass/out-soft/bounce` |
| Vidro | `--glass-alpha/blur/saturate/sheen/rim/shade` |
| Sombra | `--shadow-soft/lift/glass` |

### Temas (`themes.css`)

Quatro, selecionados por `[data-theme]` no `<html>`: `escuro` (padrão),
`meianoite`, `nebula`, `claro`. Cada bloco só redefine superfícies e texto —
raio, tempo, vidro e acento vêm de `tokens.css`.

O tema `claro` inverte a lógica do vidro: o brilho vira branco e a sombra
interna quase some, senão a superfície fica suja.

### Como as preferências viram CSS

`stores/settings.ts` → `applySettings()` escreve tudo no `<html>` e o CSS faz
o resto:

```ts
root.dataset.theme = v.theme;
root.dataset.motion = v.motion;      // 'on' | 'off'
root.dataset.gpu = v.gpu;
root.dataset.desktop = '1';          // só no app
root.style.setProperty('--color-accent', v.accent);
root.style.setProperty('--color-accent-soft', hexToRgba(v.accent, 0.16));
root.style.setProperty('--color-accent-fg', contrastOn(v.accent));  // preto ou branco
root.style.setProperty('--radius-scale', String(v.radius));
root.style.setProperty('--glass-alpha', String(v.glass));
root.style.setProperty('--speed', v.motion === 'off' ? '0.001' : String(v.motionSpeed));
```

Chamado em `main.tsx` **antes do primeiro render** — sem isso o app pisca no
tema padrão.

## Vidro líquido

`<Glass>` (`components/ui/Glass.tsx`) escolhe a variante (`panel`, `card`,
`pill`) e, quando pedido, liga extras caros:

- `live` — o brilho especular segue o ponteiro (`useLiquidPointer`). Ligue só
  onde o cursor costuma passar.
- `refract` — refração de verdade por filtro SVG (`#liquid-refract`:
  `feTurbulence` → `feGaussianBlur` → `feDisplacementMap`), montado uma vez em
  `<GlassFilters />` no topo do `App`. Reserve para superfícies flutuantes.

## Primitivas (`components/ui/`)

| Arquivo | Nota |
|---|---|
| `Button.tsx` | `Button` (variantes `primary`/`soft`/`ghost`/`danger`, tamanhos `sm`/`md`/`block`) e `IconButton` — este último **exige** `label`, que vira `title` **e** `aria-label` |
| `Modal.tsx` | sobre Radix `Dialog`. Foco preso, Escape, clique fora, `aria`, scroll travado — exatamente o que a versão à mão errava. `onConfirm` devolvendo `false` mantém aberto |
| `Menu.tsx`, `Toggle.tsx`, `Field.tsx`, `Avatar.tsx`, `Tooltip.tsx`, `Toaster.tsx`, `Glass.tsx` | idem, todos finos |

`cn()` (`lib/cn.ts`) = `clsx` + `tailwind-merge`; a última classe vence
conflitos do Tailwind.

## Estrutura de tela

```
Shell (layout/Shell.tsx)
├── TitleBar                  só no desktop
└── quatro colunas
    ├── GuildRail             trilho de servidores (+ criar/entrar)
    ├── ChannelSidebar        canais de texto e salas de voz + CallBar
    ├── Stage                 ← o único que cresce
    │   ├── TextChannel       se há canal de texto aberto (precedência)
    │   ├── ShareHud + VoiceStage   se estou numa sala
    │   └── EmptyStage
    └── MembersPanel          abre/fecha, escolha salva em dsx:membersOpen
```

Um canal de texto aberto tem **precedência** sobre a sala, sem sair dela: o
áudio continua e clicar na sala de novo volta para o vídeo — por isso
`joinVoice` na sala em que já estou não é no-op.

### O palco (`components/stage/`)

- `useStageEntries.ts` monta a lista do que exibir agora, recalculando a cada
  `tick`. Distingue `intendsScreen` (anunciou) de `sharing` (dá para exibir).
- `VoiceStage.tsx` tem dois modos: **grade** (1 / 2 / 2-3 colunas conforme a
  quantidade) e **destaque** (um grande + fita de `h-28` embaixo). A troca é
  animada pelo `layout` do Motion — os tiles deslizam em vez de sumirem.
- `Tile.tsx` é o participante: vídeo, ou avatar, ou o *watch prompt* (miniatura
  borrada + botão "Assistir transmissão").

Três comentários no palco documentam bugs visuais reais e não devem ser
desfeitos sem entender:

1. `overflow-hidden` **só** no container mais externo de `VoiceStage`.
   Repetir nos internos cortava o topo dos avatares numa grade baixa.
2. O container do tile destacado é `grid`, não `div`: um bloco comum não
   estica o Tile, e o `<video>` caía para a altura intrínseca — vídeo pequeno
   encostado no topo com vão vazio embaixo.
3. Tela cheia usa `createPortal(tile, document.body)`. `position: fixed`
   sozinho não basta: um ancestral com `backdrop-filter` cria contexto de
   empilhamento próprio e prende o `z-index` lá dentro.

`getVideo`/`getRoot` são `useCallback` estáveis — sem isso, cada render criava
função nova, o `useEffect` do `AnnotationLayer` reexecutava a cada `bump`, e o
cleanup desligava a caneta no instante seguinte a ela ser ligada.

## Configurações (`components/settings/`)

Uma seção por arquivo em `sections/`, agrupadas em quatro grupos:

| Grupo | Seções |
|---|---|
| Usuário | Minha conta |
| Aplicativo | Voz e vídeo, Transmissão, Atalhos de teclado, Anotações |
| Aparência | Tema e cores, Animações |
| Sistema | Aplicativo *(desktop)*, Atualizações *(desktop)*, Sobre |

`desktopOnly: true` some no navegador.

## Atalhos (`hooks/useKeyboardShortcuts.ts`)

Configuráveis, serializados como `"Ctrl+Alt+KeyM"` e comparados por
`shortcutMatches` (`lib/format.ts`) — que exige **igualdade exata** dos
modificadores.

| Ação | Padrão |
|---|---|
| Mudo | `KeyM` |
| Transmitir tela | `KeyS` |
| Apertar para falar | `Space` |
| Anotar | `KeyP` |
| Configurações | `Ctrl+,` / `Cmd+,` |
| Sair do destaque / tela cheia / caneta | `Esc` (nesta ordem) |
| Reiniciar o app *(desktop)* | `Shift+R` |

Regras: atalho digitado dentro de campo pertence ao campo (`isTyping`);
`window.blur` solta o PTT (senão o microfone fica aberto com a pessoa em outro
programa); `beforeunload` derruba a sala.

## Responsividade

O layout encolhe antes de quebrar — o palco é o último a ceder:

- < 1280 px: a coluna de canais estreita;
- < 1180 px: a de membros também (232 → 184);
- < 768 px: a navegação das configurações vira só ícones;
- antes disso, os rótulos dos controles da chamada somem.

## Feedback (`lib/feedback.ts`)

Cada aviso é um pulso de luz nas superfícies de vidro (`.feedback-flare`, com
reflow forçado para reiniciar a animação) **mais** uma nota curta de
oscilador. Não há arquivo de áudio de propósito: um oscilador não precisa ser
baixado, não atrasa o boot e nunca falha por 404 num build empacotado.

Tipos: `join`, `leave`, `message`, `announce`, `mute`, `unmute`,
`screenstart`, `screenstop`, `deafen`, `undeafen` — subindo para "começou",
descendo para "terminou". O som depende de o navegador já ter liberado áudio;
a luz sempre acontece.

## Ícones

SVG inline do **Lucide**, grade 24×24, traço 2, `currentColor`. **Nunca
emoji**: emoji muda de desenho, tamanho e linha-base conforme sistema e fonte,
e era a origem dos desalinhamentos em botões.
