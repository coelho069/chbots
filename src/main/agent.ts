// ============================================================
//  Agent — tipos de ferramenta, histórico e a ferramenta claude_code
// ============================================================

import { listMessages } from './db/repos/conversations';
import type { ChatTurn } from './llm/provider';
import type { Db } from './db/connection';
import type { Message } from '@shared/types';
import { runClaudeCode } from './claudeCode';

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
//  loadHistory — Carrega histórico completo de uma conversa
//
//  Busca todas as mensagens do banco de dados e converte para
//  o formato ChatTurn esperado pelo LLM.
//
//  Retorna histórico em ordem cronológica (mais antigos primeiro).
// ============================================================

export function loadHistory(db: Db, conversationId: number): ChatTurn[] {
  const messages = listMessages(db, conversationId);
  return messages.map((msg: Message) => ({
    role: msg.role as ChatTurn['role'],
    content: msg.content
  }));
}

// ============================================================
//  claude_code — roda o Claude Code CLI local (Ollama) numa pasta
//
//  Registrada nas ferramentas embutidas do chat (index.ts). Sempre pede
//  aprovação do usuário antes de executar, pois o CLI pode editar arquivos.
// ============================================================

export const CLAUDE_CODE_TOOL_DEF = {
  name: 'claude_code',
  description: 'Executa uma tarefa de programação com o Claude Code local (modelo do Ollama) numa pasta do computador. Pode ler e editar arquivos dessa pasta. Exige aprovação do usuário.',
  inputSchema: {
    type: 'object',
    properties: {
      tarefa: { type: 'string', description: 'O que o Claude Code deve fazer' },
      pasta: { type: 'string', description: 'Caminho absoluto da pasta de trabalho' }
    },
    required: ['tarefa', 'pasta']
  }
}

export async function handleClaudeCodeTool(
  input: Record<string, unknown>,
  { modelo, timeoutMin }: { modelo: string; timeoutMin: number },
  confirm: (tarefa: string, pasta: string) => Promise<boolean>
): Promise<string> {
  const tarefa = String(input.tarefa ?? '')
  const pasta = String(input.pasta ?? '')
  if (!(await confirm(tarefa, pasta))) return 'Execução negada pelo usuário.'
  const r = await runClaudeCode({ tarefa, pasta, modelo, timeoutMin })
  return r.ok ? r.resposta : `Erro: ${r.erro}`
}
