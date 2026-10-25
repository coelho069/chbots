import type { Db } from '../connection'
import { now } from '../connection'

export function getMcpTranslation(db: Db, toolName: string, originalDescription: string): string | null {
  const row = db.prepare(
    'SELECT translated_description FROM mcp_tool_translations WHERE tool_name = ? AND original_description = ?'
  ).get(toolName, originalDescription) as { translated_description: string } | undefined
  return row?.translated_description ?? null
}

export function saveMcpTranslation(db: Db, toolName: string, originalDescription: string, translatedDescription: string): void {
  db.prepare(
    `INSERT INTO mcp_tool_translations (tool_name, original_description, translated_description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tool_name, original_description) DO UPDATE SET translated_description = excluded.translated_description, updated_at = excluded.updated_at`
  ).run(toolName, originalDescription, translatedDescription, now(), now())
}
