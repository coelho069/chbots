import type { Db } from '../connection'
import { now } from '../connection'

export interface PageRecord { id: number; title: string; html: string; createdAt: string; updatedAt: string }

export function listPages(db: Db): PageRecord[] {
  return (db.prepare('SELECT * FROM pages ORDER BY updated_at DESC').all() as any[]).map(toPage)
}
export function getPage(db: Db, id: number): PageRecord | null {
  const r = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as any
  return r ? toPage(r) : null
}
export function insertPage(db: Db, title: string, html: string): PageRecord {
  const { lastInsertRowid } = db.prepare('INSERT INTO pages (title, html, created_at, updated_at) VALUES (?, ?, ?, ?)').run(title, html, now(), now())
  return getPage(db, Number(lastInsertRowid))!
}
export function updatePage(db: Db, id: number, html: string): PageRecord {
  db.prepare('UPDATE pages SET html = ?, updated_at = ? WHERE id = ?').run(html, now(), id)
  return getPage(db, id)!
}
export function deletePage(db: Db, id: number): void {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
}
function toPage(r: any): PageRecord {
  return { id: r.id, title: r.title, html: r.html, createdAt: r.created_at, updatedAt: r.updated_at }
}
