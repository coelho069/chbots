# IPC e API HTTP dos Fluxos

## Para que serve

Referência de todos os canais IPC (Electron renderer ↔ main) e das rotas HTTP (porta 3111) relacionados a Fluxos.

## Onde está

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/shared/ipc.ts` | Nomes dos canais (constantes) |
| `src/main/ipc.ts` | Implementação dos handlers IPC |
| `src/main/api.ts` | Rotas HTTP na porta 3111 |

## IPC renderer → main

### `flows:list`
- **Parâmetros**: nenhum
- **Retorno**: `FlowSummary[]` (id, name, description, createdAt, updatedAt, nodeCount, schedule)
- **Ação**: lista todos os fluxos ordenados por nome

### `flows:get`
- **Parâmetros**: `flowId: number`
- **Retorno**: `FlowDetail | null` (inclui `graph: FlowGraph`)
- **Ação**: retorna os dados completos de um fluxo incluindo nós e arestas

### `flows:create`
- **Parâmetros**: `input: FlowSaveInput` (name, description, graph)
- **Retorno**: `FlowDetail`
- **Ação**: cria um novo fluxo; valida o grafo antes de salvar

### `flows:save`
- **Parâmetros**: `flowId: number`, `input: FlowSaveInput`
- **Retorno**: `FlowDetail`
- **Ação**: substitui o grafo inteiro do fluxo numa transação; valida antes de salvar

### `flows:remove`
- **Parâmetros**: `flowId: number`
- **Retorno**: void
- **Ação**: exclui o fluxo e todo o histórico (CASCADE)

### `flows:run`
- **Parâmetros**: `flowId: number`
- **Retorno**: `FlowRun` (o registro criado imediatamente)
- **Ação**: inicia a execução manual do fluxo; retorna antes de terminar

### `flows:runs`
- **Parâmetros**: `flowId: number`
- **Retorno**: `FlowRun[]` (últimas 100)
- **Ação**: lista o histórico de execuções de um fluxo

### `flows:run-steps`
- **Parâmetros**: `runId: number`
- **Retorno**: `FlowRunStep[]`
- **Ação**: lista os passos de uma execução específica

### `flows:cancel`
- **Parâmetros**: `runId: number`
- **Retorno**: void
- **Ação**: cancela a execução em andamento (AbortSignal + rejeita interrupt pendente)

### `flows:status`
- **Parâmetros**: `runId: number`
- **Retorno**: `{ vars, ultimoResultado, activeNodeId } | null`
- **Ação**: retorna o estado atual do checkpoint LangGraph de uma execução

### `flows:interrupt-respond`
- **Parâmetros**: `runId: number`, `approved: boolean`
- **Retorno**: void
- **Ação**: resolve o interrupt pendente (aprovação/rejeição de nó perigoso)

## Eventos main → renderer (push)

### `flows:step`
- **Payload**: `FlowStepEvent { flowId, runId, step: FlowRunStep }`
- **Quando**: emitido a cada mudança de estado de um passo (running → success/error)

### `flows:runs-changed`
- **Payload**: `flowId: number`
- **Quando**: emitido ao iniciar ou finalizar uma execução (para atualizar a lista de runs)

### `flows:interrupt`
- **Payload**: `{ runId, flowId, value: InterruptValue }`
- **Quando**: emitido quando um nó perigoso precisa de aprovação

## API HTTP porta 3111

Usada pelo app Android (e qualquer cliente HTTP local).

### `GET /api/flows`
- **Parâmetros**: nenhum
- **Resposta**: `FlowSummary[]` (JSON)
- **Ação**: lista todos os fluxos

### `GET /api/flows/:id/runs`
- **Parâmetros**: `id` (flowId no path)
- **Resposta**: `FlowRun[]` (JSON)
- **Ação**: histórico de execuções do fluxo

### `POST /api/flows/:id/run`
- **Parâmetros**: `id` (flowId no path), body ignorado
- **Resposta**: `FlowRun` (JSON) ou `501` se o runner não estiver disponível
- **Ação**: dispara a execução manual do fluxo

> Não há endpoints HTTP para `flows:cancel`, `flows:status` ou `flows:interrupt-respond` — essas operações são exclusivamente IPC.

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| `POST /api/flows/:id/run` retorna 501 | `flowRunner` não foi injetado na API | Problema de configuração no main |
| Evento `flows:interrupt` não chega ao renderer | Renderer não está registrado no canal | Verificar `onFlowInterrupt` no renderer |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
