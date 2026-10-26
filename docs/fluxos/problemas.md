# Problemas Comuns nos Fluxos

## Para que serve

Referência rápida de erros, suas causas e como resolvê-los, organizada por momento em que ocorrem.

## Onde está

| Arquivo | Mensagens de erro |
|---------|------------------|
| `src/shared/flows.ts` | `validateGraph` — erros de estrutura |
| `src/main/flows/langgraphRunner.ts` | Erros de runtime (timeout, cancelamento, rejeição) |
| `src/main/flows/runner.ts` | "Este fluxo já está em execução", "Fluxo não encontrado" |
| `src/main/flows/engine.ts` | Erros específicos por tipo de nó |
| `src/main/db/repos/flows.ts` | `failStaleFlowRuns` — execuções travadas |

---

## Erros ao salvar o fluxo

Produzidos por `validateGraph()`. O fluxo não é salvo enquanto houver erros.

| Mensagem exata | Causa | Como corrigir |
|----------------|-------|---------------|
| `"O fluxo tem N nós; o limite é 10."` | Mais de `MAX_FLOW_NODES = 10` nós | Remover nós |
| `"Há nós com identificador repetido."` | IDs duplicados (não ocorre pela UI normal) | Recriar o fluxo |
| `"O fluxo precisa de um Gatilho."` | Nenhum nó `trigger` no grafo | Adicionar um Gatilho |
| `"O fluxo só pode ter um Gatilho."` | Mais de um `trigger` | Remover o Gatilho extra |
| `"Há uma ligação apontando para um nó que não existe."` | Aresta com `source` ou `target` inválido | Recriar a conexão |
| `"<Nó> está ligado a ele mesmo."` | Self-loop | Remover a aresta circular |
| `"O Gatilho não pode receber ligações."` | Aresta apontando para o Gatilho | Remover a aresta |
| `"<Nó> é uma Saída e não pode ter ligações saindo dela."` | Aresta saindo de um nó `output` | `output` deve ser nó terminal |
| `"Ligação de <Nó> precisa sair por 'Sim' ou 'Não'."` | Aresta de Condição sem `conditionValue` | Recriar a aresta escolhendo o ramo |
| `"Ligação de <Nó> não pode ter valor de condição."` | Aresta não-Condição com `conditionValue` | Não ocorre pela UI normal |
| `"Ligação repetida entre <A> e <B>."` | Aresta duplicada | Remover a duplicata |
| `"Há um ciclo envolvendo: <Nós>."` | Ciclo no grafo | Desfazer as ligações que criam o ciclo |
| `"Não ligados ao Gatilho: <Nós>."` | Nós não alcançáveis a partir do Gatilho | Conectar os nós ao fluxo ou removê-los |
| `"Gatilho agendado precisa de um horário."` | `mode = 'schedule'` com `cron` vazio | Preencher a expressão cron |
| `"<Nó>: escolha um agente."` | `agentId = null` em agent/promptgen/delegate | Selecionar um agente no Inspector |
| `"<Nó>: informe a fonte."` | `source` vazio no nó Memória (modo save) | Preencher o campo Fonte |
| `"<Nó>: informe o texto a procurar."` | `value` vazio no nó Condição | Preencher o campo Valor |
| `"<Nó>: informe o tema."` | `topic` vazio no nó Buscar Notícias | Preencher o Tema |

---

## Erros durante a execução

### Timeout

**Mensagem**: `"Tempo esgotado (Ns)"` (onde N é o valor de `timeoutSec`)

**Causa**: o nó não terminou dentro do tempo configurado.

**Solução**: aumentar `timeoutSec` no Inspector do nó, ou verificar a conexão com o serviço externo.

---

### Cancelamento

**Mensagem**: `"Execução cancelada"`

**Causa**: botão **Parar** clicado ou `AbortSignal` acionado.

**Solução**: esperado — não é um erro. Re-executar se necessário.

---

### Gerador de Prompt sem ideia

**Mensagem**: `"Gerador de Prompt sem ideia"`

**Causa**: o nó `promptgen` recebeu entrada vazia.

**Solução**: garantir que o nó anterior produza texto, ou preencher o campo **Texto inicial** no Gatilho.

---

### Agente sem prompt e sem entrada

**Mensagem**: `"Agente sem prompt e sem entrada"`

**Causa**: o nó `agent` tem `refinePrompt` vazio e recebeu `ultimoResultado` vazio.

**Solução**: preencher **Prompt fixo** no Inspector ou garantir que o predecessor produza texto.

---

### Nó Delegar sem entrada

**Mensagem**: `"Nó Delegar sem entrada"`

**Causa**: o nó `delegate` recebeu entrada vazia.

**Solução**: garantir que o predecessor produza texto.

---

### Nó Ferramenta MCP: JSON inválido

**Mensagem**: `"Nó Ferramenta MCP: JSON inválido"`

**Causa**: o campo **Args** do nó `mcp-tool` não é JSON válido após substituição de `{{entrada}}`.

**Solução**: corrigir o JSON dos Args. Testar com `{}` para verificar se o problema é na substituição.

---

### Fluxo já está em execução

**Mensagem**: `"Este fluxo já está em execução"`

**Causa**: `FlowRunner.running` já contém o `flowId` (execução simultânea do mesmo fluxo não é permitida).

**Solução**: aguardar a execução atual terminar ou clicar em **Parar**.

---

### Fluxo não encontrado

**Mensagem**: `"Fluxo não encontrado"`

**Causa**: `flowId` não existe no banco (fluxo deletado após abertura da lista).

**Solução**: recarregar a tela de Fluxos.

---

### Fluxo sem gatilho

**Mensagem**: `"Fluxo sem gatilho"`

**Causa**: grafo passado ao runner sem nó `trigger` (não deveria ocorrer se `validateGraph` rodou).

**Solução**: abrir o fluxo, verificar se o Gatilho existe e re-salvar.

---

### Rejeitado pelo usuário

**Mensagem no output do nó**: `"Rejeitado pelo usuário"`  
**`_error`**: `"Rejeitado"`

**Causa**: usuário clicou **Rejeitar** no card de aprovação.

**Solução**: re-executar e clicar **Aprovar** quando o card aparecer.

---

## Execuções travadas (app fechado)

### `failStaleFlowRuns` (chamado na inicialização)

Quando o app fecha durante uma execução, na próxima abertura:

```sql
UPDATE flow_runs  SET status='error', error='Interrompida (app fechado)', finished_at=? WHERE status='running'
UPDATE flow_run_steps SET status='error', error='Interrompida', finished_at=? WHERE status='running'
```

**Como identificar**: na tela Execuções, runs com status `error` e mensagem "Interrompida (app fechado)".

**Solução**: re-executar o fluxo manualmente.

---

## Erros de agendamento

| Problema | Causa | Solução |
|----------|-------|---------|
| Fluxo agendado não dispara | Expressão cron inválida (`cron.validate` retorna false) | Corrigir a expressão; use [crontab.guru](https://crontab.guru) |
| Fluxo agendado pula um horário | Já estava em execução no horário anterior (`noOverlap: true`) | Esperado — aguardar a execução terminar |

---

## Problemas de aprovação

| Problema | Causa | Solução |
|----------|-------|---------|
| App fechou com aprovação pendente | `pendingInterrupts` vive em memória | Re-executar o fluxo; `failStaleFlowRuns` marca a execução anterior como erro |
| Card não desaparece após clicar | Problema de comunicação IPC | Verificar o console do DevTools; reiniciar o app |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
