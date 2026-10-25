import { now, type Db } from '../connection'

export interface SendDraft {
  id: number
  tool: 'send_email' | 'send_slack'
  conversationId: number
  recipient: string
  subject: string | null
  body: string
  status: 'pending' | 'sent' | 'discarded'
  createdAt: string
}

export function insertDraft(db: Db, d: Omit<SendDraft, 'id' | 'status' | 'createdAt'>): SendDraft {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO send_drafts (tool, conversation_id, recipient, subject, body, created_at) VALUES (?,?,?,?,?,?)`
  ).run(d.tool, d.conversationId, d.recipient, d.subject, d.body, now())
  return getDraft(db, Number(lastInsertRowid))!
}

export function getDraft(db: Db, id: number): SendDraft | null {
  return toDraft(db.prepare('SELECT * FROM send_drafts WHERE id = ?').get(id) as any)
}

export function updateDraftStatus(db: Db, id: number, status: 'sent' | 'discarded'): void {
  db.prepare('UPDATE send_drafts SET status = ? WHERE id = ?').run(status, id)
}

function toDraft(r: any): SendDraft | null {
  if (!r) return null
  return {
    id: r.id, tool: r.tool, conversationId: r.conversation_id,
    recipient: r.recipient, subject: r.subject, body: r.body,
    status: r.status, createdAt: r.created_at
  }
}
