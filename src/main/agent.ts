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
import { getAgent } from '../db/repos/agents';
import { getProvider } from '../db/repos/providers';
import type { ChatTurn } from '../llm/provider';

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
  const maxRounds = options.maxRounds ?? 5;
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Carrega a config do agente (modelo, prompt do sistema, ferramentas permitidas, verificar fontes)
  const agent = getAgent(chat.deps.db, agentId);
  if (!agent) throw new Error(`Agente ${agentId} não encontrado`);

  // Carrega o provedor para criar o cliente com credenciais corretas
  const provider = getProvider(chat.deps.db, agent.providerId);
  if (!provider) throw new Error(`Provedor do agente não encontrado`);

  // Obtém a chave API secreta do agente
  const apiKey = provider.keyRef ? chat.deps.secrets.get(provider.keyRef) : null;

  // Cria o cliente LLM com as credenciais corretas do provedor
  const client = chat.deps.createClient({
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey
  });

  // Monta o histórico com sistema + user message (não será regenerado em cada loop)
  const history: ChatTurn[] = [
    { role: 'user', content: userText }
  ];

  // Cache das definições de ferramentas (não muda em runtime)
  const toolDefs = buildToolDefs();

  let assistantText = '';
  let toolRound = 0;

  while (toolRound < maxRounds) {
    toolRound++;

    // Comprime histórico se > 8 mensagens (para rede lenta, reduz payload)
    if (history.length > 8) {
      history.splice(1, history.length - 8);
    }

    const result = await client.chat.completions.create({
      tools: toolDefs,
      messages: history
    });

    const message = result.choices[0]?.message;
    if (!message) break;

    assistantText = message.content ?? '';

    if (!message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    history.push({
      role: 'assistant',
      content: assistantText,
      tool_calls: message.tool_calls
    });

    for (const toolCall of message.tool_calls) {
      const toolRequest: ToolCallRequest = {
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments
      };

      const toolResult = await executor.execute(toolRequest);

      history.push({
        role: 'tool',
        content: toolResult.content,
        tool_call_id: toolCall.id
      });

      console.info(`[tool] ${toolRequest.name} -> ${toolResult.isError ? 'ERRO' : 'OK'}`);
    }
  }

  // Chama o verificador de fontes se está configurado
  if (agent.verificarFontes && chat.deps.verificador) {
    // Este será chamado de forma assíncrona para não bloquear a resposta
    chat.deps.verificador.verificarAsync(-1, assistantText, history, agent).catch((err) => {
      console.warn('[verificador] erro ao verificar fontes:', err);
    });
  }

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
