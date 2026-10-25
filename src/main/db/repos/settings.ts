import { defaultSettings, type Settings } from '@shared/types'
import type { Db } from '../connection'

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  return { ...defaultSettings, ...pick(stored) }
}

export function saveSettings(db: Db, s: Settings): Settings {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  for (const [key, value] of Object.entries(s)) stmt.run(key, JSON.stringify(value))
  return getSettings(db)
}

function pick(stored: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {}
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    if (typeof stored[key] === typeof defaultSettings[key]) out[key] = stored[key] as never
  }
  return out
}
