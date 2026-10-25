import type { Provider, ProviderKind } from '@shared/types'
import { now, type Db } from '../connection'

interface Row {
  id: number
  kind: ProviderKind
  name: string
  base_url: string
  key_ref: string | null
  created_at: string
}

export interface ProviderRecord extends Provider {
  keyRef: string | null
}

const toRecord = (r: Row): ProviderRecord => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  baseUrl: r.base_url,
  keyRef: r.key_ref,
  hasKey: r.key_ref !== null,
  createdAt: r.created_at
})

// O renderer nunca recebe key_ref.
export const toPublic = ({ keyRef: _keyRef, ...p }: ProviderRecord): Provider => p

export function listProviders(db: Db): ProviderRecord[] {
  return (db.prepare('SELECT * FROM providers ORDER BY name').all() as unknown as Row[]).map(toRecord)
}

export function getProvider(db: Db, id: number): ProviderRecord | null {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Row | undefined
  return row ? toRecord(row) : null
}

export function insertProvider(db: Db, p: { kind: ProviderKind; name: string; baseUrl: string }): ProviderRecord {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO providers (kind, name, base_url, created_at) VALUES (?, ?, ?, ?)')
    .run(p.kind, p.name, p.baseUrl, now())
  return getProvider(db, Number(lastInsertRowid))!
}

export function updateProvider(db: Db, id: number, p: { kind: ProviderKind; name: string; baseUrl: string }): void {
  db.prepare('UPDATE providers SET kind = ?, name = ?, base_url = ? WHERE id = ?').run(p.kind, p.name, p.baseUrl, id)
}

export function setProviderKeyRef(db: Db, id: number, keyRef: string | null): void {
  db.prepare('UPDATE providers SET key_ref = ? WHERE id = ?').run(keyRef, id)
}

export function providerInUse(db: Db, id: number): boolean {
  return db.prepare('SELECT 1 FROM agents WHERE provider_id = ? LIMIT 1').get(id) !== undefined
}

export function deleteProvider(db: Db, id: number): void {
  db.prepare('DELETE FROM providers WHERE id = ?').run(id)
}
