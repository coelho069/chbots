# Nós dos Fluxos

## Para que serve

Cada nó representa uma etapa de processamento dentro de um fluxo. O sistema tem 9 tipos de nó, cada um com campos próprios e comportamento definido no runner LangGraph.

## Onde está

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/shared/flows.ts` | Tipos, labels, `FlowNodeDataMap`, `defaultNodeData` |
| `src/renderer/src/flows/nodes.tsx` | Componentes visuais de cada nó no canvas |
| `src/renderer/src/flows/Inspector.tsx` | Formulários de propriedades de cada tipo |
| `src/main/flows/engine.ts` | `EngineActions`, `buildAgentPrompt`, `evaluateCondition` |
| `src/main/flows/langgraphRunner.ts` | `runFlowNode` — executa cada nó |

## Tipos de nó

### Gatilho (`trigger`)

- **Descrição**: Ponto de entrada do fluxo. Define como e quando o fluxo começa. Todo fluxo precisa de exatamente um Gatilho.
- **Campos**:
  - `mode`: `'manual'` | `'schedule'` (padrão: `'manual'`)
  - `cron`: string cron (padrão: `'0 8 * * *'`) — usado quando `mode = 'schedule'`
  - `input`: string (padrão: `''`) — texto inicial que vira a entrada do primeiro nó
- **Entradas**: nenhuma (é o nó inicial)
- **Saídas**: o valor de `input` como `ultimoResultado`
- **Exemplo de uso**: Gatilho manual com `input = "Analise o relatório Q3"` → o texto é passado para o próximo nó (ex.: Agente).
- **Nó perigoso?**: não

---

### Buscar Notícias (`news`)

- **Descrição**: Busca notícias recentes do Google News sobre um tema e idioma configurados. Retorna as notícias em texto formatado.
- **Campos**:
  - `topic`: string — tema a buscar (obrigatório)
  - `language`: `NewsLanguage` — `'pt-BR'` | `'pt-PT'` | `'en-US'` | `'es-419'` (padrão: `'pt-BR'`)
  - `count`: number — quantidade de notícias (padrão: `10`, máx: `MAX_NEWS_COUNT = 30`)
  - `timeoutSec`: number (padrão: `30`)
- **Entradas**: entrada do predecessor é ignorada
- **Saídas**: texto com as notícias encontradas
- **Exemplo de uso**: `topic = "inteligência artificial"`, `count = 10` → passa as 10 notícias mais recentes para um nó Agente que as resume.
- **Nó perigoso?**: não

---

### Gerador de Prompt (`promptgen`)

- **Descrição**: Usa a entrada recebida como "ideia" e a expande em um prompt longo, aplicando as mesmas etapas da tela Gerador de Prompts (correção, geração e expansão).
- **Campos**:
  - `agentId`: `number | null` — agente a usar (obrigatório)
  - `timeoutSec`: number (padrão: `300`) — cobre todas as etapas
- **Entradas**: ideia inicial (string) — se vazia, lança erro
- **Saídas**: prompt expandido
- **Exemplo de uso**: Gatilho com `input = "criar um chatbot de atendimento"` → Gerador de Prompt → Agente que usa o prompt gerado.
- **Nó perigoso?**: não

---

### Agente (`agent`)

- **Descrição**: Envia uma mensagem para um agente configurado e retorna a resposta.
- **Campos**:
  - `agentId`: `number | null` — agente a usar (obrigatório)
  - `refinePrompt`: string (padrão: `''`) — prompt fixo; se contém `{{entrada}}`, a entrada é inserida lá; se ambos estiverem preenchidos, são concatenados
  - `timeoutSec`: number (padrão: `120`)
  - `includeAllInputs`: boolean (padrão: `false`) — quando `true`, usa a concatenação de todas as entradas de predecessores (múltiplas arestas)
- **Entradas**: `ultimoResultado` do predecessor
- **Saídas**: resposta do agente
- **Exemplo de uso**: `refinePrompt = "Resuma em 3 parágrafos:\n\n{{entrada}}"` → resume o texto recebido.
- **Nó perigoso?**: não

---

### Condição (`condition`)

- **Descrição**: Avalia o texto recebido e roteia para o ramo `true` ou `false` conforme o operador.
- **Campos**:
  - `operator`: `'contains'` | `'not_contains'` (padrão: `'contains'`)
  - `value`: string — texto a procurar (obrigatório)
  - `caseSensitive`: boolean (padrão: `false`)
- **Entradas**: texto a avaliar
- **Saídas**: o mesmo texto (sem alteração), mais o roteamento `_branch = 'true' | 'false'`
- **Exemplo de uso**: `operator = 'contains'`, `value = 'ERRO'` → se o texto contém "ERRO", vai para o ramo true (ex.: notificação); caso contrário, ramo false (ex.: salvar).
- **Nó perigoso?**: não

---

### Saída (`output`)

- **Descrição**: Finaliza o fluxo salvando o resultado em arquivo Markdown ou exibindo uma notificação.
- **Campos**:
  - `action`: `'save_md'` | `'notify'` (padrão: `'save_md'`)
  - `folder`: string (padrão: `''`) — pasta de destino; vazio = pasta padrão `Documentos\CH BOTS`
  - `fileName`: string (padrão: `'{fluxo}-{data}.md'`) — nome do arquivo com variáveis
  - `title`: string (padrão: `''`) — título da notificação
  - `timeoutSec`: number (padrão: `30`)
- **Entradas**: conteúdo a salvar/notificar
- **Saídas**: mensagem de confirmação (`"Arquivo salvo: <caminho>"` ou `"Notificação exibida"`)
- **Exemplo de uso**: `action = 'save_md'`, `fileName = 'relatorio-{data}.md'` → salva o resultado do Agente em arquivo.
- **Nó perigoso?**: sim — exceto quando `action = 'notify'` (notificação não pede aprovação)

---

### Memória (`memory`)

- **Descrição**: Salva ou busca informações na memória do agente configurado.
- **Campos**:
  - `mode`: `'save'` | `'search'` (padrão: `'save'`)
  - `categories`: `string[]` (padrão: `[]`) — categorias para filtrar
  - `limit`: number (padrão: `10`) — máximo de resultados na busca
  - `source`: string (padrão: `''`) — fonte ao salvar (obrigatório no modo `save`)
  - `timeoutSec`: number (padrão: `30`)
- **Entradas**: texto a salvar (modo `save`) ou consulta (modo `search`)
- **Saídas**: confirmação do salvamento ou resultados da busca
- **Exemplo de uso**: `mode = 'save'`, `source = 'relatório'` → salva o resultado de um Agente na memória para uso futuro.
- **Nó perigoso?**: não

---

### Delegar (`delegate`)

- **Descrição**: Cria uma tarefa num agente e aguarda a conclusão (diferente de Agente: é assíncrono/task).
- **Campos**:
  - `agentId`: `number | null` — agente a usar (obrigatório)
  - `timeoutSec`: number (padrão: `120`)
- **Entradas**: descrição da tarefa (obrigatória — se vazia, lança erro)
- **Saídas**: resultado da tarefa delegada
- **Exemplo de uso**: Enviar uma tarefa de revisão para um agente especializado e aguardar a resposta antes de continuar.
- **Nó perigoso?**: sim

---

### Ferramenta MCP (`mcp-tool`)

- **Descrição**: Chama uma ferramenta de um servidor MCP configurado no app.
- **Campos**:
  - `serverName`: string — nome do servidor MCP
  - `toolName`: string — nome da ferramenta
  - `args`: string — JSON de argumentos; suporta `{{entrada}}` para interpolação
  - `timeoutSec`: number (padrão: `60`)
- **Entradas**: texto substituto de `{{entrada}}` nos args
- **Saídas**: resultado retornado pela ferramenta MCP
- **Exemplo de uso**: `serverName = "filesystem"`, `toolName = "read_file"`, `args = '{"path": "{{entrada}}"}'` → lê o arquivo cujo caminho vem da entrada.
- **Nó perigoso?**: sim

## Como funciona por dentro

1. O runner LangGraph adiciona um nó ao `StateGraph` para cada nó do fluxo.
2. Na execução, `runFlowNode` é chamado com o nó e `ultimoResultado` como entrada.
3. Cada tipo de nó chama a `EngineAction` correspondente (ex.: `actions.runAgent`, `actions.saveMarkdown`).
4. O resultado é colocado em `ultimoResultado` e `vars[nodeId]` para o próximo nó.
5. O `_branch` é definido pelo nó Condição e usado no roteamento condicional das arestas.

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| "Escolha um agente para este nó" | `agentId` null em agent/promptgen/delegate | Selecionar agente no Inspector |
| "Informe o texto a procurar" | `value` vazio na Condição | Preencher o campo Valor |
| "Informe o tema" | `topic` vazio no Buscar Notícias | Preencher o tema |
| "Informe a fonte" | `source` vazio no Memória (modo save) | Preencher a fonte |
| Nó Ferramenta MCP: JSON inválido | `args` não é JSON válido | Corrigir o JSON dos args |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
