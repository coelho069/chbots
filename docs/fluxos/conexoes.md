# Fluxos — Conexões entre nós

## Para que serve

As conexões (arestas) definem a ordem em que os nós de um Fluxo são executados e para onde vai a saída de cada nó. Nas Condições, também decidem qual ramo ("Sim" ou "Não") segue adiante. Um grafo só pode ser salvo e executado quando `validateGraph` não retorna nenhum erro.

## Onde está (arquivos reais)

| Arquivo | O que tem |
|---|---|
| `src/shared/flows.ts` | `FlowEdge`, `ConditionBranch`, `MAX_FLOW_NODES` (10), `wouldCreateCycle`, `topologicalOrder`, `reachableFrom`, `nodeRef`, `validateGraph`. Sem dependências: usado pelo main e pela UI. |
| `src/renderer/src/flows/FlowEditor.tsx` | Editor (React Flow): `isValidConnection`, `onConnect`, `handleEdgesChange`, `addNode`/`addNodeAt`, painel de problemas, autosave, importação de JSON. |
| `src/renderer/src/flows/convert.ts` | `edgeView`, `toRf`, `fromRf`, `branchLabels`: conversão entre o grafo salvo e o formato do React Flow. |

## Como ligar nós

No editor, arraste da saída de um nó até a entrada de outro. Ao soltar, `onConnect` cria a aresta (id de `newId()`) e marca o fluxo como alterado.

Enquanto você arrasta, `isValidConnection` (`FlowEditor.tsx`) recusa a ligação se:

- origem e destino são o mesmo nó;
- a origem é uma Saída (`output`) ou o destino é o Gatilho (`trigger`);
- já existe uma aresta igual (mesma origem, destino e alça);
- a ligação fecharia um ciclo (`wouldCreateCycle`).

A recusa é silenciosa: nenhuma mensagem é mostrada, a ligação simplesmente não se completa.

Para remover uma ligação, selecione-a e use `Delete` ou `Backspace` (só em modo de edição, `deleteKeyCode`). O Gatilho não pode ser apagado (`deletable: false`).

Com várias entradas, o Agente usa só a saída do predecessor imediato, a menos que `includeAllInputs` esteja ligado (`AgentNodeData`). O comportamento dos demais nós com várias entradas: não encontrado no código lido (fica no executor, fora destes arquivos).

## Arestas condicionais

```ts
interface FlowEdge {
  id: string
  source: string
  target: string
  conditionValue: 'true' | 'false' | null // só em arestas que saem de uma condição
}
```

### conditionValue: 'true' | 'false'

- `'true'` — aresta seguida quando a Condição é verdadeira (rótulo "Sim").
- `'false'` — aresta seguida quando a Condição é falsa (rótulo "Não").
- `null` — todas as arestas que não saem de uma Condição.

### Quando usar

Só em arestas que saem de um nó Condição (`contains` / `not_contains` sobre um texto). Ligue pela alça "Sim" para o caminho em que a condição é atendida e pela alça "Não" para o contrário. A alça escolhida vira o `conditionValue` (`sourceHandle` em `onConnect` e em `fromRf`).

Regras relacionadas em `validateGraph`:

- Aresta saindo de Condição **sem** `conditionValue` é erro.
- Aresta saindo de outro nó **com** `conditionValue` é erro.
- A duplicidade é medida por `origem>destino>conditionValue`, então a mesma Condição pode ligar ao mesmo destino pelo "Sim" e pelo "Não".

## Regras de validação

`validateGraph(graph)` devolve uma lista de mensagens; lista vazia = grafo válido.

### Ciclo

- **Erro:** `Há um ciclo envolvendo: <nós>.` (via `topologicalOrder`, que deixa os nós em ciclo em `cyclic`). Para laço de um nó só: `<nó> está ligado a ele mesmo.`
- **Como corrigir:** remova a ligação que volta para um nó anterior. No editor o arrastar já é bloqueado por `isValidConnection`; o erro surge em grafos vindos de fora (importação de JSON, que é recusada).

### Nó solto (não alcançado pelo Gatilho)

- **Erro:** `Não ligados ao Gatilho: <nós>.` — nós que `reachableFrom(graph, gatilho)` não alcança. Só é checado quando há exatamente um Gatilho.
- **Como corrigir:** ligue o nó a um caminho que parta do Gatilho, ou apague-o.

### Múltiplos Gatilhos

- **Erro:** `O fluxo só pode ter um Gatilho.` (e `O fluxo precisa de um Gatilho.` se não houver nenhum).
- **Como corrigir:** deixe exatamente um Gatilho, apagando os extras. Com 0 ou 2+ Gatilhos a checagem de nós soltos é pulada.

### Conexão inválida

- **Saída com saída (e qualquer ligação saindo de Saída):** `<Saída> é uma Saída e não pode ter ligações saindo dela.` A Saída é nó final; não existe regra separada para "Saída com Saída", ela cai nesta. **Corrigir:** apague a ligação que sai da Saída.
- **Gatilho com entrada:** `O Gatilho não pode receber ligações.` **Corrigir:** apague a ligação que chega ao Gatilho; ele é sempre o início.
- Na mesma checagem: ligação para nó inexistente (`Há uma ligação apontando para um nó que não existe.`) e ligação repetida (`Ligação repetida entre X e Y.`). **Corrigir:** apague a ligação indicada e refaça, se necessário.

### Limite de nós (MAX_FLOW_NODES)

- **Erro:** `O fluxo tem N nós; o limite é 10.`
- **Como corrigir:** apague nós até restarem 10 ou menos. No editor, `addNode`/`addNodeAt` já mostram o toast `Limite de 10 nós por fluxo` e não adicionam; a paleta exibe `N/10 nós`.
- Erro vizinho: `Há nós com identificador repetido.`

Outras regras de `validateGraph` (de dados, não de conexão): Gatilho agendado sem horário, Agente/Gerador de Prompt/Delegar sem agente, Memória em modo salvar sem fonte, Condição sem texto, Notícias sem tema.

## Como funciona por dentro

1. **Edição:** o editor mantém `nodes` e `edges` no formato do React Flow. `edgeView` monta cada aresta (tipo `smoothstep`, seta, rótulo "Sim"/"Não", classe `fedge-true`/`fedge-false`) e usa `conditionValue` como `sourceHandle`.
2. **Gravação:** `fromRf` converte para `FlowGraph`; `conditionValue` só é mantido se a origem for `condition` e a alça for `'true'` ou `'false'`, senão vira `null`.
3. **Validação:** a cada mudança, `problems = validateGraph(graph)` (`useMemo`). `buildNodeProblems` associa cada mensagem ao nó cujo nome (`nodeRef`, ex.: "Condição 2") aparece no texto.
4. **Efeito dos problemas:** com `problems.length > 0`, Salvar e Executar ficam desabilitados, o autosave (2 s após alterar) não roda e o selo "N problemas" lista as mensagens.
5. **Algoritmos:**
   - `wouldCreateCycle(edges, source, target)`: busca em profundidade a partir de `target`; se alcançar `source`, a ligação fecharia um ciclo.
   - `topologicalOrder`: algoritmo de Kahn, estável pela ordem dos nós; devolve `order` e `cyclic`.
   - `reachableFrom`: busca em profundidade seguindo as arestas.
6. **Importação:** `importJson` roda `validateGraph` e recusa o arquivo se houver erros (`Grafo inválido: ...`).

## Problemas comuns

- **Não consigo ligar dois nós:** `isValidConnection` recusou (ciclo, destino Gatilho, origem Saída, ligação duplicada, mesmo nó).
- **Salvar/Executar desabilitados:** passe o mouse sobre o botão ou sobre o selo "N problemas" para ver a lista.
- **"Ligação de Condição precisa sair por Sim ou Não":** a aresta não tem `conditionValue`; refaça a ligação pela alça "Sim" ou "Não".
- **"Não ligados ao Gatilho":** há nó sem caminho vindo do Gatilho; ligue-o ou apague-o.
- **Não consigo adicionar mais nós:** limite de 10.
- **Importação recusada ("Grafo inválido"):** corrija no JSON as mensagens listadas.

## Última atualização

Data: 2026-10-26  Commit: a56418d
