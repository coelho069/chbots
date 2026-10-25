import type { Db } from '../connection'
import { now } from '../connection'

export interface CachedMcpAutoTranslation {
  serverName: string
  toolName: string
  originalHash: string
  originalDescription: string
  originalInputSchema: string
  translatedDescription: string
  translatedInputSchema: string
}

export function getMcpAutoTranslation(db: Db, serverName: string, toolName: string, originalHash: string): CachedMcpAutoTranslation | null {
  const row = db.prepare(`
    SELECT server_name, tool_name, original_hash, original_description, original_input_schema,
           translated_description, translated_input_schema
    FROM mcp_tool_translations_auto
    WHERE server_name = ? AND tool_name = ? AND original_hash = ?
  `).get(serverName, toolName, originalHash) as {
    server_name: string; tool_name: string; original_hash: string; original_description: string;
    original_input_schema: string; translated_description: string; translated_input_schema: string
  } | undefined
  if (!row) return null
  return {
    serverName: row.server_name,
    toolName: row.tool_name,
    originalHash: row.original_hash,
    originalDescription: row.original_description,
    originalInputSchema: row.original_input_schema,
    translatedDescription: row.translated_description,
    translatedInputSchema: row.translated_input_schema
  }
}

export function saveMcpAutoTranslation(db: Db, value: CachedMcpAutoTranslation): void {
  const timestamp = now()
  db.prepare(`
    INSERT INTO mcp_tool_translations_auto
      (server_name, tool_name, original_hash, original_description, original_input_schema,
       translated_description, translated_input_schema, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_name, tool_name, original_hash) DO UPDATE SET
      original_description = excluded.original_description,
      original_input_schema = excluded.original_input_schema,
      translated_description = excluded.translated_description,
      translated_input_schema = excluded.translated_input_schema,
      updated_at = excluded.updated_at
  `).run(value.serverName, value.toolName, value.originalHash, value.originalDescription,
    value.originalInputSchema, value.translatedDescription, value.translatedInputSchema, timestamp, timestamp)
}

export function clearMcpAutoTranslations(db: Db): void {
  db.prepare('DELETE FROM mcp_tool_translations_auto').run()
}
