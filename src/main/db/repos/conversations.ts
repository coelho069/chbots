import type { Conversation, ConversationOrigin, Message, MessageRole } from '@shared/types'
import { now, type Db } from '../connection'

export const defaultTitle = 'Nova conversa'

interface ConversationRow {
  id: number
  agent_id: number
  title: string
  origin: ConversationOrigin
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: number
  conversation_id: number
  role: MessageRole
  content: string
  from_agent_id: number | null
  tokens_in: number | null
  tokens_out: number | null
  created_at: string
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  agentId: r.agent_id,
  title: r.title,
  origin: r.origin,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  fromAgentId: r.from_agent_id,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  createdAt: r.created_at
})

export function listConversations(db: Db, agentId: number): Conversation[] {
  const rows = db
    .prepare('SELECT * FROM conversations WHERE agent_id = ? ORDER BY updated_at DESC, id DESC')
    .all(agentId) as unknown as ConversationRow[]
  return rows.map(toConversation)
}

export function getConversation(db: Db, id: number): Conversation | null {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined
  return row ? toConversation(row) : null
}

export function insertConversation(
  db: Db,
  agentId: number,
  origin: ConversationOrigin,
  title: string = defaultTitle
): Conversation {
  const ts = now()
  const { lastInsertRowid } = db
    .prepare('INSERT INTO conversations (agent_id, title, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(agentId, title, origin, ts, ts)
  return getConversation(db, Number(lastInsertRowid))!
}

export function setConversationTitle(db: Db, id: number, title: string): void {
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
}

export function deleteConversation(db: Db, id: number): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function listMessages(db: Db, conversationId: number, beforeId?: number): Message[] {
  const rows = (
    beforeId != null
      ? db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 50').all(conversationId, beforeId)
      : db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 50').all(conversationId)
  ) as unknown as MessageRow[]
  return rows.reverse().map(toMessage)
}

export function getMessage(db: Db, id: number): Message | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  return row ? toMessage(row) : null
}

export function insertMessage(
  db: Db,
  m: {
    conversationId: number
    role: MessageRole
    content: string
    fromAgentId?: number | null
    tokensIn?: number | null
    tokensOut?: number | null
  }
): Message {
  const ts = now()
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, content, from_agent_id, tokens_in, tokens_out, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(m.conversationId, m.role, m.content, m.fromAgentId ?? null, m.tokensIn ?? null, m.tokensOut ?? null, ts)
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, m.conversationId)
  return getMessage(db, Number(lastInsertRowid))!
}
