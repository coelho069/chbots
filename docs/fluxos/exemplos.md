# Exemplos de Fluxos

## Para que serve

Três fluxos completos, passo a passo, para servir de referência ao criar automações no CH BOTS.

## Onde está

| Arquivo | Referência |
|---------|-----------|
| `src/renderer/src/flows/templates.ts` | Templates prontos no app |
| `src/shared/flows.ts` | Tipos e campos de cada nó |

> O app já vem com 4 templates prontos (Corrigir e resumir, Ideia → plano, Alerta por palavra, Resumo de notícias). Os exemplos abaixo são guias passo a passo.

---

## Exemplo 1 — Fluxo Simples (Gerador de Prompt)

**Objetivo**: receber uma ideia, gerar um prompt longo e salvar em arquivo.

**Nós**:
1. Gatilho (`trigger`)
2. Gerador de Prompt (`promptgen`)
3. Saída (`output`)

**Passo a passo**:

1. **Criar o fluxo**: na tela Fluxos, clicar em **Novo fluxo** → dar um nome (ex.: "Gerador de Prompts") → confirmar.

2. **Gatilho** (criado automaticamente):
   - Inspector → Disparo: **Manual (botão Rodar agora)**
   - Texto inicial: `Criar um assistente de vendas para e-commerce`

3. **Adicionar Gerador de Prompt**:
   - Arrastar da paleta (grupo Agentes) para o canvas.
   - No Inspector:
     - Agente: selecionar o agente desejado
     - Timeout: `300` s (padrão)

4. **Ligar os nós**:
   - Arrastar da saída do Gatilho para a entrada do Gerador de Prompt.

5. **Adicionar Saída**:
   - Arrastar `output` da paleta (grupo Saída).
   - Inspector:
     - Ação: **Salvar como .md**
     - Nome do arquivo: `prompt-{data}.md`
   - Ligar Gerador de Prompt → Saída.

6. **Salvar e executar**:
   - Botão **Salvar** → botão **Executar**.
   - Um card de **Aprovar / Rejeitar** aparece antes de salvar o arquivo (nó Saída é perigoso).
   - Clicar **Aprovar** → o arquivo é criado na pasta padrão (`Documentos\CH BOTS`).

---

## Exemplo 2 — Fluxo com Condição

**Objetivo**: buscar notícias de IA; se alguma mencionar "regulação", notificar; caso contrário, salvar em arquivo.

**Nós**:
1. Gatilho (`trigger`) — agendado
2. Buscar Notícias (`news`)
3. Condição (`condition`)
4. Saída — notificação (`output`, ramo true)
5. Saída — arquivo (`output`, ramo false)

**Passo a passo**:

1. **Criar o fluxo**: nome "Monitor de Regulação".

2. **Gatilho**:
   - Disparo: **Por horário (cron)**
   - Expressão cron: `0 8 * * 1-5` (seg–sex às 8h)

3. **Buscar Notícias**:
   - Arrastar `news` da paleta (grupo Ferramentas).
   - Tema: `inteligência artificial regulação`
   - Idioma: Português (Brasil)
   - Quantidade: `15`
   - Ligar Gatilho → Buscar Notícias.

4. **Condição**:
   - Arrastar `condition` (grupo Lógica).
   - Operador: **Contém**
   - Valor: `regulação`
   - Maiúsculas/minúsculas: não
   - Ligar Buscar Notícias → Condição.

5. **Saída — notificação** (ramo true):
   - Arrastar `output`.
   - Ação: **Notificar**
   - Título: `Alerta: regulação em pauta`
   - Ligar Condição → Saída de notificação **pela aresta "Sim" (true)**.

6. **Saída — arquivo** (ramo false):
   - Arrastar outro `output`.
   - Ação: **Salvar como .md**
   - Nome: `noticias-{data}.md`
   - Ligar Condição → Saída de arquivo **pela aresta "Não" (false)**.

7. **Salvar e ativar**: o fluxo roda automaticamente nos horários configurados.

> **Dica**: ao ligar a Condição, o editor mostra os ramos "Sim" e "Não" nas pontas da aresta — escolher o correto antes de soltar.

---

## Exemplo 3 — Fluxo com Aprovação Humana

**Objetivo**: um agente analisa um relatório recebido e depois delega uma tarefa de revisão — com aprovação do usuário antes de delegar.

**Nós**:
1. Gatilho (`trigger`)
2. Agente (`agent`) — analisa
3. Delegar (`delegate`) — **nó perigoso: pede aprovação**

**Passo a passo**:

1. **Criar o fluxo**: nome "Revisão com Aprovação".

2. **Gatilho**:
   - Disparo: Manual
   - Texto inicial: cole o relatório ou deixe em branco para digitar no momento da execução.

3. **Agente — análise**:
   - Arrastar `agent`.
   - Agente: selecionar o agente de análise.
   - Prompt fixo: `Analise o relatório recebido e liste os 3 pontos mais críticos em tópicos curtos.`
   - Ligar Gatilho → Agente.

4. **Delegar**:
   - Arrastar `delegate` (grupo Agentes).
   - Agente: selecionar o agente de revisão.
   - Timeout: `120` s
   - Ligar Agente → Delegar.

5. **Salvar e executar**:
   - Clicar **Executar**.
   - O Agente roda e produz os pontos críticos.
   - Antes de **Delegar**, o card **Aprovar / Rejeitar** aparece com:
     - Tipo: `delegate`
     - Entrada: os 3 pontos críticos (truncados a 120 chars)
   - **Aprovar**: a tarefa é delegada ao agente de revisão.
   - **Rejeitar**: o fluxo para com `status = 'error'`, saída `'Rejeitado pelo usuário'`.

---

## Problemas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Card de aprovação não aparece | Painel Run fechado | O editor abre automaticamente ao executar |
| Fluxo não dispara no horário | Cron inválido ou gatilho em modo manual | Verificar a expressão cron no Inspector |
| Ramo errado executado | Aresta conectada pelo lado errado da Condição | Recriar a aresta escolhendo "Sim" ou "Não" corretamente |

## Última atualização

Data: 2026-10-26  Commit: 19a816b
