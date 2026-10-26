# Claude Code local (Ollama)

Permite que agentes e fluxos do CH BOTS rodem o **Claude Code CLI** (`claude`) usando um
modelo local do **Ollama**, sem chave da Anthropic e sem enviar código para a nuvem.

## Pré-requisitos

- Claude Code instalado e no `PATH` (`claude --version` deve funcionar).
- Ollama rodando em `http://localhost:11434` com o modelo baixado, por exemplo:
  `ollama pull qwen2.5:0.5b`.

## Como funciona

`src/main/claudeCode.ts` → `runClaudeCode({ tarefa, pasta, modelo })`:

1. Valida a tarefa, o nome do modelo e se a pasta existe.
2. Checa o Ollama em `/api/version`; se não responder, retorna `Ollama não está rodando`.
3. Executa, **sem shell**, na pasta escolhida:
   `claude -p --output-format json --model <modelo> -- "<tarefa>"`
4. Só o processo filho recebe as variáveis abaixo (o ambiente do app não muda):
   - `ANTHROPIC_BASE_URL=http://localhost:11434`
   - `ANTHROPIC_AUTH_TOKEN=ollama` (valor fixo, não é segredo)
   - `ANTHROPIC_API_KEY=` (vazio, para não usar uma chave real por engano)
5. Tempo limite configurável em *Configurações → Claude Code local* (padrão **15 minutos**); depois disso o processo é encerrado.
6. Retorna `{ ok, resposta, erro }`, lendo o campo `result` do JSON do CLI.

## Onde usar

### Ferramenta de agente `claude_code`

Disponível para todos os agentes no chat (ferramentas embutidas, `src/main/index.ts`;
definição em `src/main/agent.ts`). Parâmetros: `tarefa` e `pasta`.
**Sempre** abre uma janela de confirmação antes de executar — o Claude Code pode editar
arquivos da pasta. O modelo vem de *Configurações → Claude Code local*.

### Nó de fluxo "Claude Code"

Na paleta, grupo *Ferramentas*. Campos:

| Campo | Padrão | Observação |
| --- | --- | --- |
| Tarefa | vazio | vazio = usa a entrada do nó; aceita `{{entrada}}` |
| Pasta | — | obrigatória |
| Modelo | `qwen2.5:0.5b` | nome do modelo no Ollama |
| Tempo limite | 900 s | até 7200 s; vale o menor entre este e o de Configurações |

O nó pede aprovação antes de rodar (como Saída, Delegar e Ferramenta MCP). Erro do
Claude Code vira falha do nó.

### Configurações

*Configurações → Claude Code local*: campo **Modelo do Claude Code local** (padrão
`qwen2.5:0.5b`), **Tempo limite (minutos)** (padrão 15, de 1 a 120) e botão **Testar Ollama**, que mostra a versão do Ollama ou o erro.

## Desempenho

O Claude Code envia um prompt de sistema grande (~20 mil tokens) a cada chamada. Em CPU,
um modelo pequeno processa algo como 70 tokens/s, ou seja, **minutos por chamada** — uma
tarefa que lê um arquivo e responde pode levar mais de 10 minutos. Para uso real, prefira GPU
e/ou um modelo com bom suporte a ferramentas e contexto de 32k ou mais.

## Segurança

- Nada de segredos: o token `ollama` é um valor fixo exigido pelo CLI.
- A tarefa é passada como argumento após `--`, sem shell: não há injeção de comandos.
- Nome de modelo restrito a letras, números e `. : / - _`, sem `-` no início.
- Toda execução exige aprovação do usuário.

## Arquivos

- `src/main/claudeCode.ts` — execução e checagem do Ollama
- `src/main/agent.ts` — definição e handler da ferramenta `claude_code`
- `src/main/index.ts` — registro da ferramenta e janela de aprovação
- `src/shared/flows.ts`, `src/shared/schemas.ts` — tipo e validação do nó `claude-code`
- `src/main/flows/actions.ts`, `engine.ts`, `langgraphRunner.ts` — execução do nó
- `src/main/db/migrations.ts` — migration 21 (tipo `claude-code` em `flow_nodes`)
- `src/renderer/src/flows/Inspector.tsx`, `nodes.tsx`, `FlowEditor.tsx` — UI do nó
- `src/renderer/src/pages/SettingsPage.tsx` — modelo e botão Testar Ollama
