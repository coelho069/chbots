# Execução de Fluxos

## Para que serve

Descreve como um fluxo é executado: desde o botão Executar até o runner LangGraph, o estado compartilhado entre nós, os limites de tempo e passos, e o que acontece em caso de erro ou cancelamento.

## Onde está

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/main/flows/langgraphRunner.ts` | `runWithLangGraph`, `FlowState`, `MAX_STEPS`, `NODE_TIMEOUT_SEC` |
| `src/main/flows/runner.ts` | `FlowRunner` — integra o runner ao banco e ao IPC |
| `src/main/flows/engine.ts` | `EngineActions`, `buildAgentPrompt`, `evaluateCondition` |
| `src/renderer/src/flows/RunViews.tsx` | `RunPanel`, `StepModal` — UI de progresso |
| `src/main/ipc.ts` | Handlers `flows:run`, `flows:cancel`, `flows:status` |

## Como usar

1. No editor, clicar no botão **Executar** (ou chamar `flows:run` via IPC com o `flowId`).
2. O painel **Run** (aba direita) mostra o progresso em tempo real.
3. Para parar antes de terminar: botão **Parar** (IPC `flows:cancel` com o `runId`).
4. O resultado final fica em **Execuções** (histórico de `flow_runs`).

## Estado da execução

O LangGraph mantém um estado compartilhado entre todos os nós do fluxo (`FlowState`):

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `messages` | `string[]` | Histórico acumulado de saídas (reducer: append) |
| `vars` | `Record<string, string>` | Mapa `nodeId → saída` de cada nó executado |
| `ultimoResultado` | `string` | Saída do nó executado mais recentemente (entrada do próximo) |
| `_branch` | `string` | Branch atual do nó Condição (`'true'` ou `'false'`) |
| `_activeNodeId` | `string` | ID do último nó processado |
| `_error` | `string` | Mensagem de erro; não-vazio interrompe a execução |

## Limites

| Limite | Valor | Onde está |
|--------|-------|-----------|
| Máximo de passos (nós executados) | `MAX_STEPS = 25` | `langgraphRunner.ts` |
| Timeout padrão por nó | `NODE_TIMEOUT_SEC = 60 s` | `langgraphRunner.ts` |
| Timeout configurável por nó | Campo `timeoutSec` de cada nó | `src/shared/flows.ts` |
| Timeout máx. configurável | 600 s (clampTimeout no Inspector) | `Inspector.tsx` |
| Limite de nós no grafo | `MAX_FLOW_NODES = 10` | `src/shared/flows.ts` |

Nós sem campo `timeoutSec` (ex.: trigger, condition) usam `NODE_TIMEOUT_SEC`.

## Fluxo de execução

### 1. Início (IPC `flows:run`)

```
renderer → IPC flows:run(flowId)
main: FlowRunner.start(flowId, 'manual')
  → insertFlowRun(db, flowId, 'manual')    # cria registro na tabela flow_runs
  → runWithLangGraph(graph, opts)           # inicia o grafo
```

### 2. Montagem do StateGraph

Para cada nó do `FlowGraph`:
- Um nó LangGraph é adicionado com `sg.addNode(nodeId, handler)`.
- Arestas são adicionadas conforme as conexões.
- Nó Condição recebe `addConditionalEdges` com mapa `{ true: nóA, false: nóB }`.
- `START → trigger`, nós sem sucessores `→ END`.

### 3. Loop de stream/interrupt

```
for attempt in range(MAX_STEPS):
    stream do grafo com streamMode: 'updates'
    → se '__interrupt__' no chunk: pausa e aguarda aprovação
    → se '_error' no chunk: retorna erro imediatamente
    → se sem interrupt: encerra loop
```

Cada nó usa `withTimeout(timeoutSec, cancelSignal, fn)` internamente.

### 4. Parar (`flows:cancel`)

```
renderer → IPC flows:cancel(runId)
main: FlowRunner.cancel(runId)
  → abortController.abort()       # AbortSignal propagado a todos os nós em execução
  → pendingInterrupts.get(runId)?.(false)  # rejeita aprovação pendente
```

O nó em execução recebe o sinal via `AbortSignal`, interrompe e retorna `_error: 'Execução cancelada'`.

## O que acontece num erro

1. O nó captura a exceção e chama `onStep({ status: 'error', error: msg })`.
2. `_error` é definido no estado do LangGraph.
3. O loop principal detecta `_error` não-vazio e interrompe o grafo.
4. `finishFlowRun(db, runId, 'error', path, error)` atualiza o banco.
5. O painel Run exibe o erro em vermelho no nó correspondente.

## Como funciona por dentro

O `FlowRunner.start()` retorna `{ run, done }`:
- `run`: o `FlowRun` recém-criado (resposta imediata ao IPC `flows:run`)
- `done`: Promise que resolve quando o fluxo termina

Eventos em tempo real são enviados via `onStep` → `IPC flows:step` → renderer atualiza o painel.

O `SqliteCheckpointer` persiste o estado do LangGraph entre passos, permitindo retomar após `interrupt()`.

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Execução para no meio sem erro | `MAX_STEPS = 25` atingido | Reduzir o número de nós ou simplificar o fluxo |
| Nó trava por muito tempo | `timeoutSec` muito alto ou serviço externo lento | Reduzir `timeoutSec` no Inspector |
| "Este fluxo já está em execução" | `FlowRunner.running` já contém o `flowId` | Aguardar a execução atual terminar ou clicar Parar |
| Resultado não aparece na aba Run | Painel direito estava fechado | Abrir o painel com `]` |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
