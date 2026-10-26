// ============================================================
//  Agent — orquestração de fluxo de ferramentas (tool loop)
//  Pattern: User Prompt -> LLM Tool Call -> Executor -> Tool Result -> LLM Final Response
//  
//  Esta camada integra os wrappers nativos ao fluxo de chat do LLM,
//  permitindo que o modelo opte por chamar ferramentas nativas em tempo real.
// ============================================================

import { ChatService, type BuiltinToolSet } from '../services/chat';
import { ToolExecutor, type ToolCallRequest, type ToolCallResult } from './executor';
import TOOL_REGISTRY from './registry';

// ============================================================
//  LlmToolDef — Definição de ferramenta para LLM (OpenAI-style)
//  Diferente do ToolDef do llm/provider.ts (que é o schema base)
// ============================================================

export interface LlmToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

// ============================================================
//  Converte o registry para a forma esperada pelo LLM
// ============================================================

export function buildToolDefs(): LlmToolDef[] {
  return TOOL_REGISTRY.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.id,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, p]) => [
            key,
            { type: p.type, description: p.description }
          ])
        ) as Record<string, { type: string; description: string }>,
        required: t.parameters.required
      }
    }
  }));
}

// ============================================================
//  Chat com tool loop integrado (User Prompt -> LLM -> Tools -> LLM Final)
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

  let history = [];
  let assistantText = '';
  let toolRound = 0;

  while (toolRound < maxRounds) {
    toolRound++;

    // Envia o texto do agente para o cliente (streaming)
    onChunk({ conversationId, delta: assistantText, done: false });

    const result = await chat.deps.createClient({ kind: undefined, baseUrl: '', apiKey: '' }).chat.completions.create({
      model: 'ch-bots-tool-model',
      messages: history,
      tools: buildToolDefs(),
      tool_choice: 'auto',
      stream: false,
      timeout: timeoutMs
    });

    const choice = result.choices?.[0];
    if (!choice) throw new Error('resposta_vazia_do_llm');

    const message = choice.message;
    assistantText = message.content ?? '';

    // Se não há tool calls, terminamos
    if (!message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    // Executa cada tool call
    for (const tc of message.tool_calls) {
      const toolRequest: ToolCallRequest = {
        toolCallId: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}')
      };

      const toolResult = await executor.execute(toolRequest);

      // Adiciona o resultado ao histórico para o LLM final
      history.push({
        role: 'tool',
        content: toolResult.content,
        toolCallId: tc.id
      });

      // enviar feedback sobre a execução da ferramenta
      console.info(`[tool] ${toolRequest.name} -> ${toolResult.isError ? 'ERRO' : 'OK'}`);
    }
  }

  // O LLM retorna a resposta final (já com contexto das ferramentas)
  return assistantText;
}

// ============================================================
//  Construtor de BuiltinToolSet para integração no ChatService
// ============================================================

export class NativeToolSet implements BuiltinToolSet {
  public defs: LlmToolDef[];

  constructor() {
    this.defs = buildToolDefs();
  }

  public async handle(
    name: string,
    input: Record<string, unknown>,
    conversationId: number
  ): Promise<string> {
    const executor = new ToolExecutor();
    const request: ToolCallRequest = {
      toolCallId: `native-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      arguments: input
    };

    const result = await executor.execute(request);
    return result.content;
  }
}

// ============================================================
//  Exportação padrão
// ============================================================

export default runToolLoop;
