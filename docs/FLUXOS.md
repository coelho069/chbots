# Fluxos â€” Guia completo

> **Para quem Ã© este guia?** Para qualquer pessoa que usa o CH BOTS e quer automatizar tarefas
> encadeando vÃ¡rios agentes, sem precisar ficar copiando e colando respostas manualmente.

---

## 1. O que Ã© um Fluxo e quando usar

Um **Fluxo** Ã© um diagrama visual onde vocÃª conecta blocos (chamados de *nÃ³s*) em sequÃªncia.
Cada bloco faz uma coisa â€” chamar um agente, verificar uma condiÃ§Ã£o, salvar um arquivo â€” e a
resposta de um bloco vira automaticamente a entrada do bloco seguinte.

| SituaÃ§Ã£o | Use Fluxo | Use Rotina simples |
|---|---|---|
| Precisa passar o resultado de um agente para outro | âœ” | |
| Quer ramificar o processamento (ex.: "se contÃ©m ERRO, notificar") | âœ” | |
| Ã‰ uma Ãºnica tarefa agendada para um agente | | âœ” |
| Precisa apenas de um lembrete ou resumo diÃ¡rio | | âœ” |

**Resumindo:** use Fluxo quando a tarefa tem mais de um passo ou precisa de decisÃµes no meio.

---

## 2. Criando seu primeiro fluxo (passo a passo)

### 2.1 Abrir a tela Fluxos

1. Na barra lateral do CH BOTS, clique em **Fluxos**.
2. Ã€ esquerda aparece a lista dos fluxos existentes (vazia no inÃ­cio).
3. Clique em **+ Novo** para criar um fluxo em branco.

### 2.2 Adicionar o Gatilho

Quando um fluxo Ã© criado, o nÃ³ **Gatilho** jÃ¡ aparece no canvas. Se ele nÃ£o estiver lÃ¡:

1. Na barra de ferramentas (parte superior), clique em **+ Gatilho**.
2. Clique no nÃ³ Gatilho para selecionÃ¡-lo; o painel direito mostrarÃ¡ as configuraÃ§Ãµes.
3. Em **Modo**, deixe **Manual (Rodar agora)** por enquanto.
4. Em **Texto inicial**, escreva o texto que serÃ¡ enviado ao primeiro agente â€” por exemplo:
   `Corrija os erros de ortografia do seguinte parÃ¡grafo: ...`

### 2.3 Adicionar dois Agentes

1. Clique em **+ Agente** na barra de ferramentas. Um bloco Agente aparece no canvas.
2. Clique no bloco para selecionÃ¡-lo e, no painel direito, escolha o agente desejado no campo
   **Agente**.
3. Preencha o **Prompt de Refinamento** se quiser dar uma instruÃ§Ã£o extra (opcional).
4. Repita os passos 1â€“3 para adicionar um segundo Agente.

### 2.4 Ligar os nÃ³s com setas

1. Passe o mouse sobre a **bolinha Ã  direita** de um nÃ³ â€” ela fica destacada.
2. Clique e arraste atÃ© a **bolinha Ã  esquerda** do prÃ³ximo nÃ³.
3. Solte: uma seta aparece conectando os dois.

Ligue: **Gatilho â†’ Agente 1 â†’ Agente 2**.

> As bolinhas do lado direito sÃ£o *saÃ­das* e as do lado esquerdo sÃ£o *entradas*. VocÃª nÃ£o
> consegue criar ciclos nem ligar nÃ³s em direÃ§Ã£o invÃ¡lida â€” o app rejeita automaticamente.

### 2.5 Salvar

Clique em **Salvar\*** (canto superior direito). O asterisco indica que hÃ¡ alteraÃ§Ãµes nÃ£o salvas.
Quando salvo, o botÃ£o muda para **Salvo**.

### 2.6 Rodar agora

1. Clique em **Rodar agora** (botÃ£o azul, canto superior direito).
2. O app muda automaticamente para a aba **ExecuÃ§Ã£o** e vocÃª verÃ¡ os nÃ³s piscando em
   amarelo enquanto rodam.
3. Quando terminar, os nÃ³s ficam verdes (sucesso) ou vermelhos (erro).
4. Clique em qualquer nÃ³ para ver o que entrou e saiu dele.

---

## 3. Tipos de nÃ³

### Gatilho

**Para que serve:** marca o inÃ­cio do fluxo e fornece o texto inicial.

| Campo | O que preencher |
|---|---|
| **Modo** | `Manual` = sÃ³ roda quando vocÃª clicar "Rodar agora". `Agendado` = roda automaticamente no horÃ¡rio definido. |
| **HorÃ¡rio (cron)** | VisÃ­vel sÃ³ no modo Agendado. Formato cron padrÃ£o, ex.: `0 8 * * *` = todos os dias Ã s 8h. |
| **Texto inicial** | O texto que entra no primeiro nÃ³ conectado. Pode ficar em branco se o Agente seguinte nÃ£o precisar de entrada. |

> SÃ³ pode haver **um** Gatilho por fluxo.

**Exemplo:** modo Manual, texto inicial = `"Liste as tarefas pendentes de hoje."`

---

### Buscar notÃ­cias

**Para que serve:** busca as notÃ­cias mais recentes de um tema no Google NotÃ­cias (RSS) e passa a
lista adiante. Precisa de internet. A entrada recebida Ã© ignorada.

| Campo | O que preencher |
|---|---|
| **Tema** | O assunto da busca, ex.: `inteligÃªncia artificial`. ObrigatÃ³rio. |
| **Idioma** | EdiÃ§Ã£o do Google NotÃ­cias: PortuguÃªs (Brasil) Ã© o padrÃ£o. |
| **Quantidade de notÃ­cias** | De 1 a 30. PadrÃ£o: 10. |

A saÃ­da Ã© uma lista numerada com **tÃ­tulo, fonte, data e link** de cada notÃ­cia. Tempo limite: 30 s.
Sem internet, o nÃ³ fica vermelho com a mensagem "Sem conexÃ£o com a internet".

**Exemplo:** tema = `energia solar`, quantidade = 5 â†’ Agente "Resuma as notÃ­cias abaixo".

---

### Gerador de Prompt

**Para que serve:** recebe uma ideia (a saÃ­da do nÃ³ anterior), corrige o texto e a transforma num prompt
profissional com no mÃ­nimo 3000 caracteres, nas mesmas seÃ§Ãµes da tela **Gerador de Prompts**. A saÃ­da Ã© o prompt.

| Campo | O que preencher |
|---|---|
| **Agente que gera** | O agente cujo provedor e modelo serÃ£o usados (o prompt de sistema dele nÃ£o entra). |
| **Tempo limite do nÃ³** | PadrÃ£o 300 s. O nÃ³ faz de 2 a 4 chamadas ao modelo, cada uma com atÃ© 60 s. |

Se o prompt vier curto, o nÃ³ pede ao modelo para expandir atÃ© 2 vezes. Cada geraÃ§Ã£o tambÃ©m aparece no histÃ³rico
da tela Gerador de Prompts.

**Exemplo:** Gatilho com o texto "quero um asistente pra cardapio semanal" â†’ Gerador de Prompt â†’ SaÃ­da (.md).

---

### Agente

**Para que serve:** chama um de seus agentes configurados com a entrada recebida.

| Campo | O que preencher |
|---|---|
| **Agente** | Escolha um dos agentes criados na tela Agentes. |
| **Prompt de Refinamento** | InstruÃ§Ã£o extra que vai *antes* da entrada, ex.: `"Responda em bullet points."`. Pode ficar vazio. |
| **Limite de tempo (s)** | Quantos segundos o app espera antes de cancelar. PadrÃ£o: 120 s. |

**Exemplo:** agente = "Revisor de Textos", refinamento = `"Corrija gramÃ¡tica e pontuaÃ§Ã£o."`,
limite = 120 s.

---

### CondiÃ§Ã£o

**Para que serve:** verifica se a entrada contÃ©m (ou nÃ£o contÃ©m) um texto e bifurca o fluxo em
dois caminhos: **Sim** e **NÃ£o**. Apenas um dos dois caminhos Ã© percorrido; o outro fica
*ignorado*.

| Campo | O que preencher |
|---|---|
| **Operador** | `contÃ©m` ou `nÃ£o contÃ©m`. |
| **Texto a procurar** | O trecho que o app procura na entrada, ex.: `"ERRO"`. |
| **Diferenciar maiÃºsculas** | Marque se `erro` e `ERRO` devem ser tratados diferente. |

**Exemplo:** operador = `contÃ©m`, texto = `"ERRO"` â†’ o fluxo vai pelo caminho **Sim** se a
entrada tiver a palavra ERRO.

---

### SaÃ­da

**Para que serve:** finaliza o fluxo salvando um arquivo ou exibindo uma notificaÃ§Ã£o.

| Campo | O que preencher |
|---|---|
| **AÃ§Ã£o** | `Salvar .md` salva a entrada como arquivo Markdown. `NotificaÃ§Ã£o do Windows` exibe um alerta na bandeja. |
| **Pasta** | (sÃ³ para Salvar .md) Caminho da pasta. Vazio = `Documentos\CH BOTS`. |
| **Nome do arquivo** | (sÃ³ para Salvar .md) Suporta `{fluxo}` e `{data}`, ex.: `{fluxo}-{data}.md`. O arquivo nunca Ã© sobrescrito. |
| **TÃ­tulo** | (sÃ³ para NotificaÃ§Ã£o) TÃ­tulo da notificaÃ§Ã£o. Vazio = nome do fluxo. |

**Exemplo:** aÃ§Ã£o = `Salvar .md`, pasta vazia, nome = `resumo-{data}.md`.

---

## 4. Como a resposta passa entre os nÃ³s e como ramificar

### Encadeamento simples (linear)

```
Gatilho â†’ Agente 1 â†’ Agente 2 â†’ SaÃ­da
```

A saÃ­da do Gatilho entra no Agente 1. A resposta do Agente 1 entra no Agente 2. A resposta do
Agente 2 entra na SaÃ­da.

### Dois caminhos chegando ao mesmo nÃ³

Se um nÃ³ recebe de dois caminhos diferentes (ambos bem-sucedidos), as duas entradas sÃ£o
**unidas** com uma linha separadora (`---`) antes de entrar no prÃ³ximo nÃ³.

### RamificaÃ§Ã£o com CondiÃ§Ã£o

```
Agente 1 â†’ CondiÃ§Ã£o â†’ (Sim) â†’ SaÃ­da A
                    â†’ (NÃ£o) â†’ SaÃ­da B
```

A CondiÃ§Ã£o inspeciona a resposta do Agente 1 e escolhe apenas **um** dos dois caminhos. O
outro Ã© marcado como *ignorado* e nÃ£o roda.

> Para criar a seta do lado **Sim**, arraste da bolinha verde (parte inferior direita do nÃ³
> CondiÃ§Ã£o). Para o lado **NÃ£o**, arraste da bolinha vermelha (abaixo da verde).

---

## 5. Cores durante a execuÃ§Ã£o e como ver a resposta de cada nÃ³

Durante e apÃ³s uma execuÃ§Ã£o, cada nÃ³ recebe uma cor de borda indicando seu estado:

| Cor / Estilo | Estado | O que significa |
|---|---|---|
| **Amarelo pulsando** | Rodando | O nÃ³ estÃ¡ em execuÃ§Ã£o agora. |
| **Verde** | Sucesso | O nÃ³ terminou sem erros. |
| **Vermelho** | Erro | O nÃ³ encontrou um problema (tempo esgotado, agente indisponÃ­vel etc.). |
| **Tracejado cinza** | Ignorado | O nÃ³ nÃ£o foi alcanÃ§ado (ficou fora do caminho escolhido pela CondiÃ§Ã£o, ou estava apÃ³s um nÃ³ que falhou). |

### Ver a entrada e saÃ­da de um nÃ³

1. Certifique-se de estar na aba **ExecuÃ§Ã£o** (botÃ£o na barra de ferramentas, ao lado de **Editar**).
2. Selecione a execuÃ§Ã£o que quer inspecionar na lista Ã  direita.
3. Clique sobre qualquer nÃ³ no canvas.
4. Uma janela aparece mostrando: **Entrada**, **SaÃ­da** e, se houver, a **mensagem de erro**.

As setas entre nÃ³s tambÃ©m ficam verdes quando aquele caminho foi percorrido com sucesso.

---

## 6. Limites

| Regra | Detalhe |
|---|---|
| **Sem ciclos** | NÃ£o Ã© possÃ­vel criar um caminho que volte para um nÃ³ jÃ¡ visitado. O app rejeita a ligaÃ§Ã£o na hora. |
| **MÃ¡ximo 10 nÃ³s** | O fluxo nÃ£o pode ter mais de 10 nÃ³s no total (Gatilho + todos os outros). |
| **Timeout por nÃ³** | Agente: padrÃ£o 120 s (configurÃ¡vel). SaÃ­da (salvar arquivo): padrÃ£o 30 s. Se o tempo esgotar, o nÃ³ falha com "Tempo esgotado". |
| **SÃ³ roda com o app aberto** | Fluxos agendados dependem do processo do CH BOTS estar ativo. Com "manter na bandeja" ligado (padrÃ£o), fechar a janela nÃ£o encerra o app â€” use **Sair** no Ã­cone da bandeja para encerrar de vez. |

---

## 7. TrÃªs exemplos prontos

### 7.1 "Corrigir texto e resumir"

```
Gatilho (Manual)
  â””â”€ texto inicial: [cole aqui o texto que quer melhorar]

Agente 1 (ex.: "Revisor")
  â””â”€ refinamento: "Corrija gramÃ¡tica, ortografia e pontuaÃ§Ã£o."

Agente 2 (ex.: "Resumidor")
  â””â”€ refinamento: "FaÃ§a um resumo de atÃ© 3 parÃ¡grafos do texto corrigido."

SaÃ­da (Salvar .md)
  â””â”€ nome: correcao-{data}.md
```

**Como usar:** abra o fluxo, edite o texto inicial no Gatilho, salve e clique em "Rodar agora".
O arquivo `.md` com o resumo corrigido serÃ¡ salvo em `Documentos\CH BOTS`.

---

### 7.2 "Ideia â†’ refinar â†’ plano"

```
Gatilho (Manual)
  â””â”€ texto inicial: [descreva sua ideia em poucas frases]

Agente 1 (ex.: "Refinador de Ideias")
  â””â”€ refinamento: "Expanda esta ideia, aponte pontos fortes e fracos."

Agente 2 (ex.: "Planejador")
  â””â”€ refinamento: "Com base na ideia refinada, crie um plano de aÃ§Ã£o em etapas numeradas."

SaÃ­da (Salvar .md)
  â””â”€ nome: plano-{data}.md
```

---

### 7.3 "Se contÃ©m ERRO, notificar"

```
Gatilho (Manual)
  â””â”€ texto inicial: [cole aqui o log ou relatÃ³rio a verificar]

Agente 1 (ex.: "Analisador de Logs")
  â””â”€ refinamento: "Analise o texto e liste todos os erros encontrados. Se nÃ£o houver erros, responda: SEM ERROS."

CondiÃ§Ã£o
  â””â”€ operador: contÃ©m  |  texto: "ERRO"

  Caminho Sim â†’  SaÃ­da A (NotificaÃ§Ã£o)
                   â””â”€ tÃ­tulo: "AtenÃ§Ã£o: erros encontrados"

  Caminho NÃ£o â†’  SaÃ­da B (Salvar .md)
                   â””â”€ nome: log-ok-{data}.md
```

---

## 8. Erros comuns e como resolver

| Mensagem / SituaÃ§Ã£o | Causa | Como resolver |
|---|---|---|
| *"O fluxo precisa de um Gatilho"* | NÃ£o hÃ¡ nÃ³ Gatilho no canvas. | Clique em **+ Gatilho** na barra de ferramentas. |
| *"Escolha um agente"* | Um nÃ³ Agente nÃ£o tem agente selecionado. | Clique no nÃ³ e escolha um agente no painel direito. |
| *"Informe o texto a procurar"* | O campo "Texto a procurar" do nÃ³ CondiÃ§Ã£o estÃ¡ vazio. | Clique na CondiÃ§Ã£o e preencha o campo. |
| *"NÃ£o ligados ao Gatilho: â€¦"* | HÃ¡ nÃ³s que nÃ£o estÃ£o conectados a nenhum caminho que parte do Gatilho. | Ligue todos os nÃ³s ao fluxo principal ou remova os que nÃ£o sÃ£o necessÃ¡rios. |
| *"HÃ¡ um ciclo envolvendo: â€¦"* | Uma ligaÃ§Ã£o criaria um laÃ§o infinito. | Remova a seta que fecha o ciclo (clique nela e pressione Delete). |
| *"Limite de 10 nÃ³s excedido"* | O fluxo tem mais de 10 nÃ³s. | Remova nÃ³s desnecessÃ¡rios ou divida em dois fluxos separados. |
| *"Tempo esgotado (120s)"* | O agente demorou mais do que o limite configurado. | Aumente o **Limite de tempo** no nÃ³ Agente, ou verifique se o provedor de IA estÃ¡ acessÃ­vel. |
| BotÃ£o "Rodar agora" acinzentado | O fluxo tem problemas de validaÃ§Ã£o ou jÃ¡ estÃ¡ rodando. | Corrija os problemas indicados no badge vermelho/amarelo na barra de ferramentas. |
| Fluxo agendado nÃ£o disparou | O app estava fechado no horÃ¡rio. | Deixe o app na bandeja (nÃ£o use **Sair**) para que os agendamentos funcionem. |

---

## 9. Onde ver o histÃ³rico de execuÃ§Ãµes

Cada fluxo guarda um histÃ³rico das execuÃ§Ãµes passadas.

**Como acessar:**

1. Abra o fluxo desejado na tela **Fluxos**.
2. Clique no botÃ£o **ExecuÃ§Ã£o** na barra de ferramentas (ao lado de **Editar**).
3. O painel direito mostra a lista de execuÃ§Ãµes, da mais recente para a mais antiga, com:
   - Data e hora de inÃ­cio.
   - Status (Rodando / ConcluÃ­da / Erro).
   - O caminho percorrido (ex.: `Gatilho â†’ Agente â†’ CondiÃ§Ã£o â†’ SaÃ­da`).
   - A mensagem de erro, se houver.
4. Clique em qualquer execuÃ§Ã£o da lista para ver os detalhes; depois clique em um nÃ³ no canvas
   para inspecionar entrada e saÃ­da daquele passo.

> **Nota:** o histÃ³rico de execuÃ§Ãµes fica dentro de cada fluxo. NÃ£o existe uma tela global de
> histÃ³rico de fluxos separada â€” a tela **ExecuÃ§Ãµes** no menu lateral mostra o histÃ³rico das
> **Rotinas** (tarefas agendadas simples), nÃ£o dos Fluxos.

