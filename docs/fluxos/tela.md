# Tela Fluxos — Layout e Interface

## Para que serve

A tela Fluxos é o editor visual onde o usuário cria, edita, salva e executa fluxos de automação. É composta por uma paleta de nós, um canvas interativo (React Flow) e um painel lateral de propriedades/execução.

## Onde está

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/renderer/src/flows/FlowsPage.tsx` | Lista de fluxos e roteamento para o editor |
| `src/renderer/src/flows/FlowEditor.tsx` | Editor principal: paleta, canvas, painel |
| `src/renderer/src/flows/Inspector.tsx` | Formulários de propriedades de cada tipo de nó |
| `src/renderer/src/flows/flows.css` | Estilos da tela |
| `src/renderer/src/flows/layout.ts` | Auto-layout (posicionamento automático dos nós) |
| `src/renderer/src/flows/useUndoable.ts` | Histórico de desfazer/refazer |

## Como usar

1. Abrir a tela Fluxos no menu lateral.
2. Clicar em **Novo fluxo** ou selecionar um existente na lista.
3. Arrastar nós da paleta para o canvas.
4. Clicar em um nó para editar suas propriedades no painel direito.
5. Ligar nós arrastando da saída de um para a entrada de outro.
6. Clicar em **Salvar** (ou `Ctrl+S`) e depois em **Executar** para rodar.

## Layout e componentes

### Paleta de nós

Localizada no painel esquerdo (`flow-left-panel`). Agrupa os tipos de nó disponíveis:

| Grupo | Tipos |
|-------|-------|
| Agentes | agent, promptgen, delegate |
| Ferramentas | mcp-tool, news |
| Lógica | condition, memory |
| Saída | output |

O nó **Gatilho** (`trigger`) não aparece na paleta — é criado automaticamente em fluxos novos (ou via template). Cada item da paleta mostra ícone e nome; há campo de busca (`paletteSearch`) para filtrar.

### Canvas (React Flow)

Área central onde os nós são posicionados e ligados. Usa a biblioteca `@xyflow/react`. Oferece:
- Arrastar e soltar nós
- Conectar nós com arestas
- Zoom e pan
- MiniMap (canto inferior direito, togglável)
- Controles de zoom (botões +/−/fit)
- Background quadriculado

### Painel de propriedades / execução

Painel direito (`flow-right-panel`) com duas abas:
- **Props**: formulário do nó selecionado (componente `Inspector`)
- **Run**: histórico de execuções, progresso em tempo real e card de aprovação

Quando um nó é clicado, o painel de props abre automaticamente.

### Painéis ocultáveis

Ambos os painéis (esquerdo e direito) podem ser recolhidos. O estado é persistido em `localStorage`:
- `flows.leftOpen` (padrão: `true`)
- `flows.rightOpen` (padrão: `true`)

Quando uma execução começa, o painel direito abre automaticamente.

### Modo foco

Ativado pelo botão na barra de ferramentas (`toggleFocus`). Oculta os dois painéis laterais e expande o canvas para tela cheia. A tecla `Escape` desativa o modo foco.

### Atalhos de teclado

| Tecla | Ação |
|-------|------|
| `[` | Recolher/abrir paleta (painel esquerdo) |
| `]` | Recolher/abrir painel direito |
| `Escape` | Sair do modo foco |
| `Ctrl+Z` | Desfazer |
| `Ctrl+Y` | Refazer |
| `Ctrl+B` | **não encontrado no código** (conflito com atalho global do app) |
| `Ctrl+J` | **não encontrado no código** |

> Nota: `Ctrl+B` e `Ctrl+J` foram citados na especificação mas não existem no código de `FlowEditor.tsx`. Os atalhos reais para os painéis são `[` e `]`.

### Responsividade

O layout usa `data-left` e `data-right` no elemento canvas para ajustar margens via CSS quando os painéis estão abertos ou fechados. Não há breakpoints de viewport definidos no código encontrado — a responsividade é baseada no estado dos painéis.

## Como funciona por dentro

1. `FlowsPage` carrega a lista de fluxos via `api.flows.list()` e renderiza `FlowEditor` quando um fluxo é selecionado.
2. `FlowEditor` mantém o estado de nós e arestas com `useNodesState`/`useEdgesState` do React Flow.
3. Mudanças são marcadas como `dirty`; ao tentar fechar ou trocar de fluxo, o usuário é alertado se houver alterações não salvas.
4. O histórico de desfazer usa `useUndoable` (pilhas `pastRef` e `futureRef`).
5. Ao salvar, `fromRf()` converte do formato React Flow para `FlowGraph` do domínio, `validateGraph()` verifica erros e `api.flows.save()` persiste via IPC.
6. Templates (`flowTemplates` de `templates.ts`) pré-populam novos fluxos.

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Paleta ou painel desapareceram | Foram recolhidos (estado em localStorage) | Pressionar `[` ou `]` |
| Alterações perdidas | Saiu sem salvar | Usar `Ctrl+Z` ou recarregar — não há auto-save |
| Canvas não responde | Modo foco ativo com painéis ocultos | Pressionar `Escape` |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
