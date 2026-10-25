import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { getMcpTranslation, saveMcpTranslation } from '../src/main/db/repos/mcpTranslations'

describe('cache SQLite de traduções MCP', () => {
  it('salva e recupera por nome da tool e descrição original', () => {
    const db = openDatabase(':memory:')
    expect(getMcpTranslation(db, 'tool_nova', 'Original')).toBeNull()
    saveMcpTranslation(db, 'tool_nova', 'Original', 'Tradução')
    expect(getMcpTranslation(db, 'tool_nova', 'Original')).toBe('Tradução')
    expect(getMcpTranslation(db, 'tool_nova', 'Outra descrição')).toBeNull()
  })
})
