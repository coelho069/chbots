import type { ConversationOrigin, HandoffResult } from '@shared/types'
import type { Db } from '../db/connection'
import { getAgent } from '../db/repos/agents'
import { insertConversation } from '../db/repos/conversations'
import { titleFrom, type ChatService } from './chat'

export interface HandoffRequest {
  fromAgentId: number
  toAgentId: number
  content: string
  instruction: string
  origin: Extract<ConversationOrigin, 'handoff' | 'routine'>
}

export function buildHandoffText(instruction: string, fromAgentName: string, content: string): string {
  const header = instruction.trim() || `Continue a partir do resultado abaixo.`
  return `${header}\n\n--- Resultado de ${fromAgentName} ---\n${content}`
}

// Abre uma conversa nova no agente de destino com a saída do agente de origem.
export async function handoff(db: Db, chat: ChatService, req: HandoffRequest): Promise<HandoffResult> {
  const from = getAgent(db, req.fromAgentId)
  const to = getAgent(db, req.toAgentId)
  if (!from || !to) throw new Error('Agente não encontrado')
  if (from.id === to.id) throw new Error('Escolha um agente diferente do de origem')

  const title = titleFrom(`De ${from.name}: ${req.instruction || req.content}`)
  const conversation = insertConversation(db, to.id, req.origin, title)
  const reply = await chat.send(conversation.id, buildHandoffText(req.instruction, from.name, req.content), {
    fromAgentId: from.id
  })
  return { conversationId: conversation.id, reply }
}
