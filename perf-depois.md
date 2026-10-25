# Relatório de Performance — CH BOTS v0.2.2

## Comparativo Antes × Depois

| Métrica | Antes (v0.2.1) | Depois (v0.2.2) | Δ |
|---|---|---|---|
| Bundle JS principal (`index.js`) | 1 163 KB | 595 KB | **−49%** |
| Bundle CSS principal (`index.css`) | 40 KB | 14 KB | **−65%** |
| Chunk lazy `FlowsPage.js` | — | 509 KB | separado |
| Main process (`out/main/index.js`) | 102 KB | 103 KB | +1 KB |
| Preload (`out/preload/index.js`) | 7 KB | 7 KB | sem mudança |
| Instalador `.exe` | 116,7 MB | 116,3 MB | −0,4 MB |

## Otimizações aplicadas

### SQLite
- `PRAGMA synchronous = NORMAL` — reduz fsync sem risco de corrupção em crash normal
- `PRAGMA cache_size = -10000` (~10 MB de cache em memória)
- `PRAGMA temp_store = MEMORY` — tabelas temporárias na RAM
- `PRAGMA mmap_size = 268435456` (256 MB de mmap)
- 7 novos índices (migration 6): mensagens, conversas, execuções de fluxo/rotina, fatos de memória

### Startup
- `scheduler.start()` e `flowRunner.startScheduling()` movidos para dentro do evento `ready-to-show` — janela exibida antes de tarefas pesadas inicializarem

### Chat / Streaming
- Throttle de 50 ms: deltas acumulados em ref, `setState` chamado no máximo 20×/s em vez de a cada token

### React
- `React.memo` no `TabBar` — evita re-render a cada navegação
- `useDebounce(300 ms)` em `BlackBoxPage` e `MemoryPage` — filtra sem disparar load a cada tecla

### Code Splitting (lazy imports)
| Página | Estratégia |
|---|---|
| `FlowsPage` | `React.lazy` + `Suspense` |
| `BlackBoxPage` | `React.lazy` + `Suspense` |
| `MemoryPage` | `React.lazy` + `Suspense` |
| `PromptGenPage` | `React.lazy` + `Suspense` |
| `RoutinesPage` | `React.lazy` + `Suspense` |
| `RunsPage` | `React.lazy` + `Suspense` |
| `SettingsPage` | `React.lazy` + `Suspense` |

Apenas `AgentsPage` e `ChatPage` permanecem no bundle principal (abertas na inicialização).

### Empacotamento
- `asar: true` — arquivos empacotados, acesso ao disco mais rápido
- `files` restrito a `out/main`, `out/preload`, `out/renderer`, `resources/icon.png`, `package.json`
- Excluídos: `*.map`, `*.test.*`, `tests/`, `*.md`, `node_modules/.cache/`

## Comportamento
Nenhuma mudança visível ao usuário. Todos os 132 testes passam.
