# Persistência dos Fluxos

## Para que serve

Descreve como os fluxos, seus grafos, execuções e checkpoints são armazenados no banco SQLite local do app.

## Onde está

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/main/db/migrations.ts` | DDL de todas as tabelas de fluxos |
| `src/main/db/repos/flows.ts` | CRUD: flows, nodes, edges, runs, steps |
| `src/main/flows/langgraphCheckpointer.ts` | `SqliteCheckpointer`, `ensureCheckpointTables` |
| `src/main/flows/runner.ts` | `startScheduling`, `failStaleFlowRuns` |
| `src/main/ipc.ts` | Query da Caixa-Preta (`/api/blackbox`) |

## Tabelas SQLite

### `flows`

Metadados de cada fluxo.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | Identificador |
| `name` | TEXT | Nome |
| `description` | TEXT | Descrição |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

---

### `flow_nodes`

Nós do grafo de cada fluxo.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID do nó |
| `flow_id` | INTEGER FK→flows | Fluxo pai (CASCADE DELETE) |
| `type` | TEXT | Tipo do nó (trigger, agent, etc.) |
| `data_json` | TEXT | JSON com os campos do nó |
| `position_x` | REAL | Posição X no canvas |
| `position_y` | REAL | Posição Y no canvas |

---

### `flow_edges`

Conexões entre nós.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID da aresta |
| `flow_id` | INTEGER FK→flows | Fluxo pai |
| `source_node` | TEXT FK→flow_nodes | Nó de origem |
| `target_node` | TEXT FK→flow_nodes | Nó de destino |
| `condition_value` | TEXT | `'true'` \| `'false'` \| NULL |

---

### `flow_runs`

Registro de cada execução de fluxo.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | Identificador da execução |
| `flow_id` | INTEGER FK→flows | Fluxo executado |
| `trigger` | TEXT | `'manual'` \| `'schedule'` |
| `started_at` | TEXT | ISO 8601 |
| `finished_at` | TEXT \| NULL | NULL enquanto em execução |
| `status` | TEXT | `'running'` \| `'ok'` \| `'error'` |
| `path_json` | TEXT | JSON array de IDs dos nós executados com sucesso |
| `error` | TEXT \| NULL | Mensagem de erro |

---

### `flow_run_steps`

Detalhes de cada passo de execução.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | INTEGER PK | — |
| `run_id` | INTEGER FK→flow_runs | Execução pai |
| `node_id` | TEXT | ID do nó (sem FK — sobrevive à edição do fluxo) |
| `status` | TEXT | `'running'` \| `'success'` \| `'error'` \| `'skipped'` |
| `input` | TEXT | Entrada recebida pelo nó |
| `output` | TEXT \| NULL | Saída produzida |
| `error` | TEXT \| NULL | Erro, se houver |
| `started_at` | TEXT | — |
| `finished_at` | TEXT \| NULL | — |

---

### Tabelas do `SqliteCheckpointer`

Criadas por `ensureCheckpointTables(db)` e usadas pelo LangGraph para persistir o estado entre passos:

**`flow_checkpoints`**

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `thread_id` | TEXT | `runId.toString()` |
| `checkpoint_ns` | TEXT | Namespace (padrão: `''`) |
| `checkpoint_id` | TEXT | ID do checkpoint |
| `checkpoint` | TEXT | JSON do estado |
| `metadata` | TEXT | Metadados LangGraph |
| `created_at` | TEXT | — |

**`flow_checkpoint_writes`**

Escrita pendente por canal/tarefa. Usada internamente pelo LangGraph para garantir atomicidade.

## Retomada após fechar o app

### `failStaleFlowRuns(db)`

Chamado em `FlowRunner.startScheduling()` (na inicialização do app):

```sql
UPDATE flow_runs SET status = 'error', error = 'Interrompida (app fechado)', finished_at = ? 
WHERE status = 'running'

UPDATE flow_run_steps SET status = 'error', error = 'Interrompida', finished_at = ?
WHERE status = 'running'
```

Garante que execuções que estavam em andamento quando o app fechou não fiquem travadas com `status = 'running'`.

### Thread ID e checkpoint

O `thread_id` do LangGraph é o `runId` (como string). Os checkpoints ficam em `flow_checkpoints`. Porém, como os `pendingInterrupts` (aprovações pendentes) vivem apenas em memória, uma execução parada em aprovação não pode ser retomada após fechar o app — é marcada como erro.

## Registro em Execuções / Caixa-Preta

As execuções ficam visíveis na tela **Execuções** do app via `listFlowRuns(db, flowId)`.

A **Caixa-Preta** (API `/api/blackbox`) faz a query:

```sql
SELECT fr.*, f.name as flow_name
FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id
ORDER BY fr.started_at DESC LIMIT 200
```

(Fonte: `src/main/ipc.ts` e `src/main/api.ts`.)

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Execução presa como "running" | App fechou durante execução antes de `failStaleFlowRuns` | Reiniciar o app — `failStaleFlowRuns` corrige automaticamente |
| Checkpoints acumulando | Cada execução cria entradas em `flow_checkpoints` | Não há limpeza automática no código encontrado |
| Dados perdidos após deletar fluxo | `flows` tem `ON DELETE CASCADE` para nodes/edges/runs | Esperado — deletar fluxo remove todo o histórico |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
