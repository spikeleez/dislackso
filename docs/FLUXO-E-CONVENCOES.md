# Fluxo de trabalho e convenções

## O fork

```
spikeleez/dislackso  (upstream, destino dos PRs)
        ▲
        │ pull request
        │
tornellihenrique/dislackso  (origin, este repositório)
        │
        └── d:\Projetos\Web\dislackso   (cópia local, branch master)
```

O remote `upstream` está configurado:

```bash
git remote -v
# origin    git@github.com:tornellihenrique/dislackso.git
# upstream  https://github.com/spikeleez/dislackso.git

# ver a diferença em relação ao upstream
git fetch upstream
git rev-list --left-right --count upstream/master...master
```

## Ciclo de uma contribuição

O mantenedor aceita a documentação interna no upstream, então o branch de
trabalho sai do `master` local (mantido em dia com `git merge
upstream/master`):

```bash
git checkout master && git fetch upstream && git merge upstream/master
git checkout -b feat/nome-curto

# ... alterações ...
npm run typecheck && npm run build      # portões obrigatórios

git commit -m "feat(escopo): descrição em português"
git push -u origin feat/nome-curto

gh pr create \
  --repo spikeleez/dislackso \
  --base master \
  --head tornellihenrique:feat/nome-curto \
  --title "feat(escopo): ..." \
  --body "..."
```

Antes de abrir o PR, confira que só o esperado está lá:

```bash
git log --oneline upstream/master..HEAD
git diff --stat upstream/master...HEAD
```



Ao abrir o PR, `ci-build.yml` roda no upstream: builda Windows e Linux e anexa
os instaladores na execução do Actions — dá para baixar e testar o build do PR
sem compilar localmente.

Precedente: os PRs #2, #8, #12, #13 e #14 vieram do fork de `ricardofuly` e
foram mesclados. É o caminho esperado.

**Nunca faça push nem abra PR sem confirmação explícita.**

## Portões de qualidade

Não há ESLint, Prettier nem framework de teste. O que existe:

| Portão | Comando | Quando |
|---|---|---|
| Tipos | `npm run typecheck` | sempre, antes de commitar |
| Build web | `npm run build` | sempre |
| Build desktop | `npm run build:desktop` | se mexeu em algo que o Electron carrega |
| Empacotamento | `npm run dist` | se mexeu em `desktop/`, `scripts/` ou `package.json > build` |
| Teste manual | `node scripts/test-channel-delete.js` | se mexeu em `server/socket/presence.js` |

`ci-build.yml` roda `npm run dist` nas duas plataformas em todo PR — ou seja,
quebrar o empacotamento aparece no CI mesmo que passe localmente.

## Versionamento e release

Semver, no `package.json`. Publicar uma versão:

```bash
npm version minor          # cria o commit e a tag vX.Y.Z
git push --follow-tags
```

A tag `v*` dispara `build-release.yml`, que:

1. builda Windows e Linux em paralelo e publica no Release da tag
   (instaladores + `.blockmap` + `latest.yml` + `latest-linux.yml`);
2. anexa o `.zip` portátil (Windows);
3. **só depois** avisa quem está com o app aberto (`/api/admin/notify-update`).

Publicar o Release também dispara `render-deploy.yml`, que redeploya o servidor.

`latest.yml` e `latest-linux.yml` são **obrigatórios**: são os manifestos que o
atualizador lê. Sem eles, apps instalados não enxergam a versão nova.

Além disso, cada versão ganha uma entrada no topo de `release_notes.md`
(`### Versão X.Y.Z`, em português, com subtítulos em negrito e bullets).

> Atenção: `build.publish` no `package.json` aponta para **`spikeleez/dislackso`**.
> Um `--publish always` rodado a partir deste fork tentaria escrever no
> upstream. Releases são responsabilidade do mantenedor, não deste fork.

## Estilo de commit

Mistura duas formas, ambas em português:

- Conventional-ish para mudanças pontuais:
  `feat(audio): ...`, `fix(ci): ...`, `build(linux): ...`, `ci: ...`,
  `feature(hotkey): ...`
- Frase corrida para marcos e releases:
  `Sobe versão para 4.0.3: administração, tela cheia de verdade e correção de imagens`

Prefira a primeira forma. Sem emoji nas mensagens.

## Estilo de código

### TypeScript (cliente)

`tsconfig.json` liga coisas que mudam como o código é escrito:

| Flag | Consequência prática |
|---|---|
| `strict` | sem `any` implícito |
| `noUncheckedIndexedAccess` | `arr[0]` é `T \| undefined` — daí os `!` e `?? fallback` espalhados |
| `verbatimModuleSyntax` | importe tipos com `import type { … }` |
| `noImplicitOverride`, `noFallthroughCasesInSwitch` | idem |
| `paths: { "@/*": ["./src/*"] }` | sempre `@/lib/...`, nunca `../../lib/...` |

Target ES2022; build desktop mira `chrome130` (o Electron embarca Chromium
conhecido), build web mira `es2022`.

### JavaScript (servidor e Electron)

CommonJS, `'use strict'` no topo, `require` no lugar de `import`. **Não
converta para ESM ou TypeScript** — é o que mantém o empacotamento simples e
o `server/` embarcável no processo do Electron.

### React

- Função nomeada exportada (`export function Nome() {}`), nunca `default`.
- Props tipadas em `interface NomeProps` logo acima do componente.
- Estilo por Tailwind, composto com `cn()`.
- Estado global em Zustand; estado local em `useState` normal.
- Ações que falam com o servidor vão para `features/<assunto>/actions.ts`,
  não dentro do componente.

### Comentários

A convenção mais forte do repositório: **comentários explicam *por quê*, não
*o quê*.** Quase todo bloco não óbvio tem um parágrafo dizendo qual bug real
ele evita ou qual padrão do navegador ele corrige. Exemplos do próprio código:

> *"`tryAllTransports` é o que importa aqui: sem ele, o socket.io tenta só o
> primeiro transporte e desiste. Em rede corporativa ou de escola, onde o
> WebSocket costuma estar bloqueado, o app ficaria preso na tela de entrada."*

> *"Referência estável: sem isto, cada render de Tile cria uma função nova, o
> useEffect de AnnotationLayer reexecuta a cada bump de tick, e o cleanup
> desliga o modo caneta assim que ele é ligado."*

Escreva assim. Tom direto, sem hype, sem "simply"/"apenas". Se um comentário
só repete o nome da função, não escreva.

### Tamanho de arquivo

Nenhum arquivo do `src/` ou `server/` passa de ~200 linhas. Se crescer, divide.
Exceção consciente: `desktop/main.js` (616).

## Idioma

Tudo em **português (pt-BR)**: interface, comentários, mensagens de erro,
commits, PRs, documentação. Identificadores de código em inglês
(`publicUser`, `handleSignal`), com exceção dos que viajam no protocolo e já
estão congelados (`'caneta'`, `'marcador'`, `'seta'`).

## Documentos do repositório

| Arquivo | Versionado? | Público-alvo |
|---|---|---|
| `README.md` | sim | usuários e quem for rodar |
| `DEPLOY.md` | sim | quem publica o servidor |
| `release_notes.md` | sim | notas por versão (o topo vira o corpo do Release) |
| `docs/CONTRATO.md` | sim | o protocolo congelado |
| `CLAUDE.md`, `docs/*.md` (os demais) | sim | documentação interna (o upstream aceita) |

O `.gitignore` tinha uma regra `*.md` que ignorava tudo — foi ela que obrigou
`README.md`, `DEPLOY.md`, `release_notes.md` e `docs/CONTRATO.md` a entrarem
com `git add -f`. A regra foi removida; todo `.md` é versionado normalmente.
Ao mudar comportamento, atualize o doc afetado no mesmo commit.
