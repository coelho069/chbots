# CH BOTS — Contexto do Projeto

## Visão geral

Aplicativo Electron (Windows) para gerenciar e conversar com múltiplos agentes de IA.
Stack: Electron + Vite + React + TypeScript + better-sqlite3.

## Arquitetura

```
src/
  main/          # processo principal Electron (Node.js)
    db/          # SQLite: openDatabase, migrations, repos
    flows/       # motor de fluxos (engine, actions, runner)
    llm/         # clientes LLM (OpenAI-compat, Anthropic, Ollama)
    services/    # Chat, Delegation, Memory, Scheduler, Mcp
    mcpConfig.ts # leitura/gravação mcp.json + criptografia safeStorage
    ipc.ts       # todos os handlers IPC
    index.ts     # entry point; instancia serviços, janela, tray
  preload/       # expõe API segura ao renderer via contextBridge
  renderer/      # React SPA
    pages/       # AgentsPage, ChatPage, McpPage, BlackBoxPage, …
    flows/       # editor visual de fluxos (React Flow)
  shared/        # tipos, schemas Zod, canais IPC, constantes
```

## Banco de dados (SQLite)

Migrations numeradas em `src/main/db/migrations.ts`. Versão atual: **13**.

| Migration | O que faz |
|-----------|-----------|
| 1–10      | Tabelas base: providers, agents, conversations, messages, flows, routines, runs, memories, bb_events, generated_prompts |
| 11        | `mcp_tools TEXT DEFAULT '[]'` em agents; tabela `mcp_calls` |
| 12        | Tabela `mcp_approvals` (aprovação por ferramenta/agente) |
| 13        | Reconstrói CHECK de `flow_nodes` para incluir nó `'mcp-tool'` |

## Funcionalidades principais

### Agentes
- CRUD de agentes com provedor, modelo, temperatura, prompt de sistema
- Cache de respostas (safeStorage + LRU)
- Delegação entre agentes (config por agente)
- Ferramentas MCP por agente (campo `mcpTools: McpToolRef[]`)

### Chat
- Streaming de respostas (OpenAI e Anthropic)
- Loop de ferramentas MCP (max 10 iterações por resposta)
- Aprovação humana por ferramenta (always ask / allow / block)
- Cards colapsáveis de tool call e pedidos de aprovação na thread

### Fluxos
- Editor visual (React Flow) com nós: message, agent, condition, loop, save-markdown, news, mcp-tool
- Nó `mcp-tool`: chama ferramenta MCP com args com suporte a `{{entrada}}`
- Execução assíncrona com log em tempo real

### MCP (Model Context Protocol)
- Transports: **stdio** (spawn sem shell, args em array) e **Streamable HTTP**
- Config em `%APPDATA%\CH BOTS\mcp.json` (formato padrão MCP)
- Segredos de env criptografados com `safeStorage` (prefixo `__secret__:<base64>`)
- Importação de mcp.json de outros apps (Claude Desktop, Cursor)
- Auto-reconexão: 3 tentativas (2 s / 5 s / 10 s)
- Timeout de 60 s por chamada; cancelável pelo botão Parar
- Aprovação humana: padrão "Sempre perguntar"; armazenada em `mcp_approvals`
- Log de conexões, chamadas e erros na Caixa-Preta (sem segredos)

### Rotinas & Execuções
- Agendamento via cron (node-cron)
- Histórico de execuções com status e logs

### Memória
- Armazenamento de fatos por agente com categorias
- Grafo de memória visual

### Caixa-Preta (BlackBox)
- Log em tempo real de todos os eventos do sistema
- Filtro por agente, tipo de evento, janela de tempo

## Fluxo de dados IPC

```
Renderer → preload (contextBridge) → ipcRenderer.invoke → ipcMain.handle (main)
Main → ipcMain.emit / event → ipcRenderer.on → React state
```

Todos os inputs IPC validados com Zod em `src/shared/schemas.ts`.
Origins checadas em `src/main/ipc.ts` (só aceita `app://`).

## Segurança

- `safeStorage.encryptString` / `decryptString` para segredos (env vars MCP, chaves de API)
- Sem shell spawn: processos MCP usam `StdioClientTransport` com `args` como array
- Segredos nunca aparecem em logs ou no renderer
- `contextIsolation: true`, `nodeIntegration: false`, CSP estrita

## Build

```
npm run dev      # desenvolvimento (hot-reload)
npm run build    # TypeScript check + Vite build
npm run dist     # empacota instalador Windows (electron-builder) → build-out/
```

Versão atual do pacote: ver `package.json`.

## Dependências notáveis

| Pacote | Uso |
|--------|-----|
| `@modelcontextprotocol/sdk@1.12.0` | Cliente MCP (stdio + HTTP) |
| `better-sqlite3` | Banco SQLite síncrono |
| `electron-builder` | Empacotamento instalador |
| `reactflow` | Editor visual de fluxos |
| `zod` | Validação de schemas |
| `node-cron` | Agendamento de rotinas |
