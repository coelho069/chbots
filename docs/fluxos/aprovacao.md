# Aprovação Humana nos Fluxos

## Para que serve

Alguns nós realizam ações com efeito colateral irreversível (salvar arquivo, delegar tarefa, chamar ferramenta externa). Antes de executá-los, o sistema pausa e exibe um card **Aprovar / Rejeitar** para o usuário. O fluxo só continua após a resposta.

## Onde está

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/main/flows/langgraphRunner.ts` | `DANGEROUS_TYPES`, `isDangerous`, `interrupt()` |
| `src/main/flows/runner.ts` | `respondInterrupt`, `pendingInterrupts` |
| `src/renderer/src/flows/RunViews.tsx` | Card Aprovar/Rejeitar na UI |
| `src/main/ipc.ts` | Handler `flows:interrupt-respond` |
| `src/shared/ipc.ts` | Canal `flows:interrupt` (evento push main → renderer) |

## Nós perigosos

```typescript
const DANGEROUS_TYPES = new Set(['output', 'delegate', 'mcp-tool'])
```

| Tipo | Perigoso? | Exceção |
|------|-----------|---------|
| `output` (`save_md`) | **sim** | — |
| `output` (`notify`) | **não** | `action === 'notify'` não pede aprovação |
| `delegate` | **sim** | — |
| `mcp-tool` | **sim** | — |
| Demais tipos | não | — |

### `isDangerous(node)`

```typescript
function isDangerous(node: FlowNode): boolean {
  if (node.type === 'output' && node.data.action === 'notify') return false
  return DANGEROUS_TYPES.has(node.type)
}
```

## O card Aprovar/Rejeitar

Quando um nó perigoso está prestes a executar, o LangGraph emite um `interrupt` com o objeto `InterruptValue`:

```typescript
interface InterruptValue {
  nodeId: string
  nodeType: string
  description: string  // ex.: 'Nó "output" está prestes a executar com entrada: "..."'
}
```

O card exibido na aba **Run** mostra:
- Tipo do nó (`nodeType`)
- Descrição da ação (entrada truncada a 120 caracteres)
- Botões **Aprovar** e **Rejeitar**

## Como funciona por dentro

### 1. Pausa no LangGraph

```typescript
// langgraphRunner.ts — dentro do handler do nó perigoso
const approved = interrupt<InterruptValue, boolean>({ nodeId, nodeType, description })
```

`interrupt()` pausa o grafo e emite `__interrupt__` no stream.

### 2. Evento para o renderer

O loop de execução detecta `__interrupt__`, extrai o `InterruptValue` e chama `onInterrupt`:

```typescript
// runner.ts
onInterrupt: (value) =>
  new Promise<boolean>((resolve) => {
    this.pendingInterrupts.set(run.id, resolve)
    this.deps.onInterrupt({ runId: run.id, flowId, value })
  })
```

`deps.onInterrupt` envia o evento `flows:interrupt` via IPC para o renderer.

### 3. Resposta do usuário

O renderer exibe o card. O usuário clica em Aprovar ou Rejeitar:

```
renderer → IPC flows:interrupt-respond(runId, approved: boolean)
main: FlowRunner.respondInterrupt(runId, approved)
  → pendingInterrupts.get(runId)?.(approved)
  → pendingInterrupts.delete(runId)
```

### 4. Retomada

O runner envia `new Command({ resume: approved })` ao LangGraph, que retorna o valor `approved` para `interrupt()`:

- **Aprovado (`true`)**: o nó executa normalmente.
- **Rejeitado (`false`)**: o nó registra `status: 'skipped'`, `output: 'Rejeitado pelo usuário'`, e define `_error: 'Rejeitado'`, interrompendo o restante do fluxo.

## Como retomar após aprovação

Não é necessária ação adicional. Após `respondInterrupt(runId, true)`, o loop de execução (`for attempt in range(MAX_STEPS)`) continua na próxima iteração com `input = new Command({ resume: true })`.

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Card não aparece | Painel Run (aba direita) estava fechado | O editor abre automaticamente o painel quando o fluxo começa |
| Fluxo para após rejeição | Comportamento esperado: `_error = 'Rejeitado'` interrompe a execução | Confirmar aprovação para continuar |
| App fechado com aprovação pendente | `pendingInterrupts` são perdidos na memória | A execução fica com status `'running'`; ao reabrir o app, `failStaleFlowRuns` marca como `'error'` |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
