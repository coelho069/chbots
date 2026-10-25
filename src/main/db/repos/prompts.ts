import { PROMPT_HISTORY_LIMIT, type GeneratedPrompt } from '@shared/types'
import { now, type Db } from '../connection'

interface Row {
  id: number
  ideia_original: string
  ideia_corrigida: string
  prompt: string
  caracteres: number
  agente_id: number | null
  criado_em: string
}

const toPrompt = (r: Row): GeneratedPrompt => ({
  id: r.id,
  originalIdea: r.ideia_original,
  correctedIdea: r.ideia_corrigida,
  prompt: r.prompt,
  chars: r.caracteres,
  agentId: r.agente_id,
  createdAt: r.criado_em
})

export function insertGeneratedPrompt(
  db: Db,
  p: { originalIdea: string; correctedIdea: string; prompt: string; agentId: number }
): GeneratedPrompt {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO prompts_gerados (ideia_original, ideia_corrigida, prompt, caracteres, agente_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(p.originalIdea, p.correctedIdea, p.prompt, countChars(p.prompt), p.agentId, now())
  return getGeneratedPrompt(db, Number(lastInsertRowid))!
}

export function getGeneratedPrompt(db: Db, id: number): GeneratedPrompt | null {
  const row = db.prepare('SELECT * FROM prompts_gerados WHERE id = ?').get(id) as Row | undefined
  return row ? toPrompt(row) : null
}

export function listGeneratedPrompts(db: Db, limit = PROMPT_HISTORY_LIMIT): GeneratedPrompt[] {
  return (db.prepare('SELECT * FROM prompts_gerados ORDER BY id DESC LIMIT ?').all(limit) as unknown as Row[]).map(toPrompt)
}

export function deleteGeneratedPrompt(db: Db, id: number): void {
  db.prepare('DELETE FROM prompts_gerados WHERE id = ?').run(id)
}

// Conta caracteres como o usuário vê (acentos e emoji contam 1), não unidades UTF-16.
export function countChars(text: string): number {
  return [...text].length
}
