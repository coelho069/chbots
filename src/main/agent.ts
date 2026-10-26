// ============================================================
//  Agent — orquestração de fluxo de ferramentas (tool loop)
//  Pattern: User Prompt -> LLM Tool Call -> Executor -> Tool Result -> LLM Final Response
//
//  Esta camada integra os wrappers nativos ao fluxo de chat do LLM,
//  permitindo que o modelo opte por chamar ferramentas nativas em tempo real.
//
//  O agente implementa um loop agentic: o LLM recebe a prompt do usuário,
//  pode decidir chamar uma ou mais ferramentas, recebe os resultados e
//  então gera a resposta final com contexto das execuções realizadas.
// ============================================================

import { ChatService, type BuiltinToolSet } from '../services/chat';
import { ToolExecutor, type ToolCallRequest, type ToolCallResult } from './executor';
import TOOL_REGISTRY from './registry';

// ============================================================
//  LlmToolDef — Definição de ferramenta para LLM (OpenAI-style)
//
//  Interface que descreve o formato de ferramenta esperado pelo LLM.
//  Segue o padrão OpenAI Function Calling com field 'function' que
//  encapsula nome, descrição e schema dos parâmetros.
//
//  Diferente do ToolDef do llm/provider.ts (que é o schema base interno),
//  esta é a forma serializada que o LLM recebe na chamada de completions.
// ============================================================

export interface LlmToolDef {
  // Campo obrigatório que identifica este como um function call
  type: 'function';
  // Dados da função disponível para o LLM
  function: {
    // Identificador único e nome da ferramenta (ex: 'send_message', 'search')
    name: string;
    // Descrição legível para ajudar o LLM a decidir quando chamar
    description: string;
    // Schema JSON dos parâmetros aceitos pela ferramenta
    parameters: {
      // Sempre 'object' no padrão OpenAI
      type: 'object';
      // Mapa de nome do parâmetro para tipo e descrição
      // Ex: { "query": { type: "string", description: "..." } }
      properties: Record<string, { type: string; description: string }>;
      // Lista de parâmetros obrigatórios
      required: string[];
    };
  };
}

// ============================================================
//  buildToolDefs — Converte o registry interno para o formato do LLM
//
//  Esta função é chamada antes de cada requisição ao LLM para construir
//  a lista de ferramentas disponíveis no formato esperado pela API.
//
//  Processo:
//  1. Itera sobre cada ferramenta em TOOL_REGISTRY (registro global)
//  2. Mapeia o ToolDef interno para LlmToolDef (padrão OpenAI)
//  3. Simplifica o schema de parâmetros mantendo apenas tipo e descrição
// ============================================================

export function buildToolDefs(): LlmToolDef[] {
  return TOOL_REGISTRY.map((t) => ({
    // Sempre 'function' para indicar function calling
    type: 'function' as const,
    function: {
      // ID da ferramenta do registry vira o nome que o LLM chamará
      name: t.id,
      // Descrição ajuda o LLM a entender quando usar esta ferramenta
      description: t.description,
      parameters: {
        // OpenAI requer sempre 'object' como tipo raiz
        type: 'object',
        // Transforma o mapa de propriedades, extraindo apenas tipo e descrição
        // Remove campos extras (ex: enum, default, etc) que não são necessários
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, p]) => [
            key,
            // Simplificação: mantém apenas type e description do schema original
            { type: p.type, description: p.description }
          ])
        ) as Record<string, { type: string; description: string }>,
        // Lista de parâmetros obrigatórios copiada do schema original
        required: t.parameters.required
      }
    }
  }));
}

// ============================================================
//  runToolLoop — Implementa o loop agentic (multi-turn com ferramentas)
//
//  Fluxo principal:
//  1. Envia a prompt do usuário ao LLM com lista de ferramentas disponíveis
//  2. Se o LLM decide chamar ferramentas:
//     a. Executa cada ferramenta via ToolExecutor
//     b. Adiciona os resultados ao histórico de mensagens
//     c. Envia tudo de volta ao LLM (feedback loop)
//  3. Repete até:
//     - O LLM não queira mais chamar ferramentas (retorna resposta final)
//     - Limite de rodadas atingido (prevenção de loops infinitos)
//
//  Parâmetros:
//    - chat: serviço de chat que cria cliente LLM
//    - executor: executa as chamadas de ferramenta
//    - conversationId: ID da conversa para logging/rastreamento
//    - userText: prompt inicial do usuário
//    - agentId: ID do agente/sessão
//    - onChunk: callback para enviar streaming de resposta ao cliente
//    - options: maxRounds (padrão 5) e timeoutMs (padrão 60s)
//
//  Retorna: string contendo a resposta final do LLM
// ============================================================

export async function runToolLoop(
  chat: ChatService,
  executor: ToolExecutor,
  conversationId: number,
  userText: string,
  agentId: number,
  onChunk: (chunk: { conversationId: number; delta: string; done: boolean }) => void,
  options: { maxRounds?: number; timeoutMs?: number } = {}
): Promise<string> {
  // Configurações com fallback padrão
  // maxRounds limita rodadas agentic para evitar loops infinitos
  // timeoutMs protege contra chamadas LLM travadas
  const maxRounds = options.maxRounds ?? 5;
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Histórico de mensagens conversa (inclui user, assistant e tool results)
  // Mantém contexto para o LLM entender a sequência de interações
  let history = [];
  // Acumula o texto da resposta do assistente da rodada atual
  let assistantText = '';
  // Contador da rodada agentic (1-based para melhor logging)
  let toolRound = 0;

  // Loop principal: continua enquanto houver rodadas disponíveis
  while (toolRound < maxRounds) {
    toolRound++;

    // Envia o texto gerado até aqui para o cliente (streaming partial)
    // O cliente pode exibir a resposta conforme chega
    onChunk({ conversationId, delta: assistantText, done: false });

    // Faz requisição ao LLM com as ferramentas disponíveis
    // O LLM pode decidir chamar nenhuma, uma ou várias ferramentas
    const result = await chat.deps
      .createClient({ kind: undefined, baseUrl: '', apiKey: '' })
      .chat.completions.create({
        // Modelo com suporte a function calling
        model: 'ch-bots-tool-model',
        // Histórico de mensagens da conversa (vazio na primeira rodada)
        messages: history,
        // Lista de ferramentas disponíveis para o LLM chamar
        tools: buildToolDefs(),
        // 'auto' deixa o LLM decidir se quer chamar ferramenta ou não
        tool_choice: 'auto',
        // stream: false para poder processar tool_calls antes de responder
        stream: false,
        // Timeout para não travar em chamadas muito lentas
        timeout: timeoutMs
      });

    // Extrai o primeiro (e único) choice da resposta
    const choice = result.choices?.[0];
    if (!choice) throw new Error('resposta_vazia_do_llm');

    // Message contém content (texto) e tool_calls (se houver)
    const message = choice.message;
    // Atualiza o texto da resposta assistente
    // Se vazio, mantém o texto anterior (pode estar continuando)
    assistantText = message.content ?? '';

    // Verifica se o LLM quer chamar ferramentas
    // Se não há tool_calls, chegamos à resposta final
    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Sai do loop: o LLM completou a resposta
      break;
    }

    // Processa cada ferramenta que o LLM quer chamar
    // Pode haver múltiplas chamadas paralelas em uma rodada
    for (const tc of message.tool_calls) {
      // Prepara a requisição para o executor
      const toolRequest: ToolCallRequest = {
        // ID único da chamada (fornecido pelo LLM)
        toolCallId: tc.id,
        // Nome da ferramenta a executar
        name: tc.function.name,
        // Parâmetros em JSON parsed (LLM envia como string)
        arguments: JSON.parse(tc.function.arguments || '{}')
      };

      // Executa a ferramenta e obtém o resultado
      // O executor cuida de validação, erro handling, etc
      const toolResult = await executor.execute(toolRequest);

      // Adiciona a mensagem de resultado ao histórico
      // O LLM usará isto para contexto na próxima rodada
      // A estrutura segue o padrão OpenAI para tool results
      history.push({
        role: 'tool',
        content: toolResult.content,
        toolCallId: tc.id
      });

      // Log de diagnóstico: registra execução de cada ferramenta
      // Ajuda a debugar e monitorar execuções agentic
      console.info(`[tool] ${toolRequest.name} -> ${toolResult.isError ? 'ERRO' : 'OK'}`);
    }
  }

  // Retorna a resposta final
  // Já contém contexto das ferramentas executadas pois foi gerada pelo LLM
  // com conhecimento dos resultados das chamadas anteriores
  return assistantText;
}

// ============================================================
//  NativeToolSet — Implementa a interface BuiltinToolSet
//
//  Esta classe fornece as definições de ferramentas e um handler
//  para o ChatService integrado. Permite que o ChatService acesse
//  as ferramentas nativas do sistema sem conhecer os detalhes
//  internos do executor.
//
//  Interface BuiltinToolSet é um contrato que ChatService espera,
//  garantindo que qualquer ToolSet pode fornecer defs e handle().
// ============================================================

export class NativeToolSet implements BuiltinToolSet {
  // Array de definições de ferramentas em formato OpenAI
  // Carregado uma vez no construtor e reutilizado para cada requisição
  // Pode ser cacheado pois o registry é imutável em runtime
  public defs: LlmToolDef[];

  // Construtor: gera as definições de ferramentas uma única vez
  constructor() {
    this.defs = buildToolDefs();
  }

  /**
   * handle — Executa uma ferramenta pelo nome com argumentos fornecidos
   *
   * Implementa parte da interface BuiltinToolSet esperada pelo ChatService.
   * Usado quando o ChatService precisa executar uma ferramenta chamada pelo LLM.
   *
   * @param name - Nome/ID da ferramenta a executar
   * @param input - Argumentos da ferramenta em forma de objeto
   * @param conversationId - ID da conversa (para rastreamento e logging)
   * @returns Promise<string> contendo o resultado da execução ou mensagem de erro
   */
  public async handle(
    name: string,
    input: Record<string, unknown>,
    conversationId: number
  ): Promise<string> {
    // Instancia um novo executor para esta chamada
    // Cada execução é isolada e stateless
    const executor = new ToolExecutor();

    // Monta a requisição no formato que o ToolExecutor entende
    const request: ToolCallRequest = {
      // Gera ID único: prefixo 'native' + timestamp + random string
      // Garante rastreabilidade e unicidade mesmo em concorrência
      toolCallId: `native-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      // Nome da ferramenta (já validado pelo LLM)
      name,
      // Argumentos já parseados (vêm como objeto Record)
      arguments: input
    };

    // Executa a ferramenta e aguarda resultado
    // ToolExecutor lida com localização, chamada e error handling
    const result = await executor.execute(request);

    // Retorna apenas o conteúdo da resposta
    // Se houve erro, result.content conterá mensagem de erro
    return result.content;
  }
}

// ============================================================
//  Exportação padrão
//
//  runToolLoop é a função principal de orquestração agentic.
//  Exportada como padrão para uso como: import runToolLoop from './agent'
// ============================================================

export default runToolLoop;
