# CH BOTS

App desktop (Electron + Node) para criar vários agentes de IA, cada um com seu prompt e modelo,
conversar com eles e passar tarefas de um para outro. Tudo roda no seu PC; os dados ficam locais.

## Comandos

```powershell
npm install        # dependências
npm run dev        # desenvolvimento com recarga automática
npm run build      # gera out/
npm start          # roda o build
npm test           # testes (vitest)
npm run test:e2e   # build + teste ponta a ponta dos Fluxos (servidor LLM falso, confere o SQLite)
npm run typecheck  # checagem de tipos
npm run dist       # instalador Windows em build-out/
```

## Primeiros passos

1. **Configurações → Provedores**: cadastre um provedor.
   - *Compatível com OpenAI*: OpenAI, OpenRouter, Groq, LM Studio etc. (ajuste a URL base).
   - *Anthropic*: chave da API Anthropic.
   - *Ollama*: modelos locais em `http://127.0.0.1:11434`, sem chave.
   Use **Testar** para confirmar a conexão.
2. **Agentes**: crie agentes com nome, prompt de sistema, provedor e modelo (**Listar** busca os modelos do provedor).
3. **Chat**: converse; em qualquer resposta, **Enviar para…** repassa o texto para outro agente.
4. **Gerador de Prompts**: escreva uma ideia (pode ter erros), escolha o agente cujo modelo vai trabalhar e clique em
   **Gerar prompt**. O app corrige o texto e gera um prompt estruturado de no mínimo 3000 caracteres (pede expansão
   ao modelo até 2 vezes). Dá para copiar, salvar em `.md`, criar um agente com ele e reabrir os últimos 20 no histórico.
   Usa o provedor/modelo do agente, não o prompt de sistema dele; cada chamada tem limite de 60 s.
5. **Rotinas**: escolha um horário, o agente que executa a tarefa e, opcionalmente, um agente que recebe a resposta.
   **Execuções** mostra o histórico, com links para as conversas geradas.

## Atalhos

- **Ctrl+B** — fecha o item aberto na tela atual (conversa, fluxo, agente, rotina, prompt). Se houver algo não salvo,
  pergunta *Salvar antes de fechar?* (Salvar / Descartar / Cancelar). Sem item aberto, volta para a tela inicial (Chat);
  nunca fecha o app. Também no menu **Arquivo → Fechar item atual** (Alt mostra o menu) e no botão × de cada item.

## Fluxos ([guia completo](docs/FLUXOS.md))

Orquestração visual: um grafo de até **10 nós**, sem ciclos, executado em sequência (ordem topológica).
A saída de cada nó vira a entrada do seguinte; quando um nó recebe de dois caminhos, as entradas são unidas
com `---`.

| Nó | O que faz |
|---|---|
| **Gatilho** | Início do fluxo. Manual (**Rodar agora**) ou por horário. O texto inicial é a primeira entrada. |
| **Buscar notícias** | Busca um tema no RSS do Google Notícias e repassa título, fonte, data e link de cada item (até 30, padrão 10; limite de 30 s). |
| **Gerador de Prompt** | Recebe uma ideia, corrige e devolve um prompt de 3000+ caracteres (as mesmas etapas da tela Gerador de Prompts; grava no histórico). Limite padrão 300 s. |
| **Agente** | Chama um agente com *Prompt de Refinamento* + entrada. Tempo limite próprio (padrão 120 s). |
| **Condição** | Procura um texto na entrada (*contém* / *não contém*) e segue por **Sim** ou **Não**. O outro lado fica *ignorado*. |
| **Saída** | Salva um `.md` (padrão `Documentos\CH BOTS`, nunca sobrescreve) ou mostra uma notificação do Windows. |

- **Editar**: arraste da paleta, ligue os pontos, clique num nó para configurar. Ciclos e ligações
  inválidas são recusados na hora; o main revalida tudo ao salvar.
- **Execução**: estados ao vivo (amarelo pulsando = rodando, verde = sucesso, vermelho = erro,
  tracejado = ignorado). Clique num nó para ver a entrada e a saída daquela execução.
- Cada execução guarda horário, status e o caminho exato percorrido; as chamadas a agentes aparecem
  no Chat como conversas marcadas *automação*.

As rotinas e os fluxos agendados só disparam com o app aberto. Com "manter na bandeja" ligado (padrão), fechar a janela
deixa o CH BOTS rodando no ícone da bandeja; use **Sair** no menu do ícone para encerrar.

## Onde ficam os dados

`%APPDATA%\CH BOTS\`
- `ch-bots.db` — SQLite (agentes, conversas, mensagens, rotinas, execuções, configurações;
  fluxos em `flows`, `flow_nodes`, `flow_edges`, `flow_runs` e `flow_run_steps`).
- `secrets.json` — chaves de API cifradas pelo Windows (DPAPI via `safeStorage`); só funcionam neste usuário/PC.

Backup: **Configurações → Fazer backup do banco**.

## Arquitetura

```
src/
├─ main/        processo principal (Node): janela, bandeja, IPC, banco, provedores, agendador
│  ├─ db/       conexão node:sqlite, migrações, repositórios
│  ├─ llm/      adaptadores OpenAI-compatível, Anthropic, Ollama (streaming)
│  ├─ services/ chat, repasse entre agentes, agendador (node-cron)
│  └─ flows/    motor de execução, ações de saída, executor/agendador de fluxos
├─ preload/     expõe window.pilotos (API mínima e tipada)
├─ renderer/    interface React (flows/: editor com @xyflow/react, estilo próprio)
└─ shared/      tipos, canais IPC, validação (zod), conversão de horários, regras de grafo
```

- Janela com `contextIsolation`, `sandbox` e sem `nodeIntegration`; o renderer só fala com o main
  por canais fixos, e o main valida toda entrada com zod e confere a origem de quem chama.
- As chaves nunca chegam ao renderer.
- Banco via `node:sqlite` embutido no Electron, sem módulo nativo para compilar.
