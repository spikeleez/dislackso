# Documentação interna — DiSlackso

Mapa do projeto escrito para não ser preciso re-estudar o código do zero.
Ponto de partida operacional: [`../CLAUDE.md`](../CLAUDE.md).

| Documento | O que cobre |
|---|---|
| [ARQUITETURA.md](ARQUITETURA.md) | Visão geral, camadas, fluxo de dados, quem chama quem |
| [MIDIA-WEBRTC.md](MIDIA-WEBRTC.md) | O motor de mídia: malha P2P, negociação, qualidade, tela, microfone |
| [SERVIDOR-E-DADOS.md](SERVIDOR-E-DADOS.md) | Express + Socket.IO, banco JSON, espelho Supabase, protocolo real |
| [DESKTOP-E-BUILD.md](DESKTOP-E-BUILD.md) | Electron, `app://`, atualizador, painel de dev, empacotamento, CI/CD |
| [INTERFACE.md](INTERFACE.md) | Design system, tokens, temas, vidro líquido, componentes, palco |
| [FLUXO-E-CONVENCOES.md](FLUXO-E-CONVENCOES.md) | Fork/PR, versionamento, release, estilo de código e de commit |
| [ARMADILHAS.md](ARMADILHAS.md) | O que quebra o app se for mexido sem cuidado |
| [CONTRATO.md](CONTRATO.md) | *(versionado, do upstream)* protocolo congelado — **parcialmente desatualizado** |

## Resumo em cinco linhas

DiSlackso é um Discord caseiro em React 19 + TypeScript no cliente e
Node/Express/Socket.IO em CommonJS no servidor. A mídia é P2P (WebRTC malha
completa); o servidor só sinaliza e guarda estado num JSON espelhado no
Postgres do Supabase. A mesma interface compila para web (Express serve
`dist/web`) e para desktop (Electron carrega `dist/desktop` por `app://`).
O diferencial técnico é o compartilhamento de tela: VP9, bitrate explícito,
`maintain-resolution` e envio sob demanda.

## Estado verificado (19/08/2026)

- `npm run typecheck` → limpo.
- `npm run build` → limpo, ~4s, bundle 638 kB (202 kB gzip).
- Fork em dia com o upstream; a documentação interna é versionada e pode ir
  nos PRs (o mantenedor aceita). Fluxo em [FLUXO-E-CONVENCOES.md](FLUXO-E-CONVENCOES.md).
- Base herdada do upstream: 45 commits, autores `spikeleez` (40) e
  `Ricardo Fuly` (5).
