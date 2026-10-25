import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpFile, saveMcpFile, type McpFileEntry } from '../src/main/mcpConfig'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('configuracao MCP em filesystem', () => {
  it('persiste npx.cmd e argumentos em linhas sem depender da conexao', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ch-bots-mcp-'))
    dirs.push(dataDir)
    const entries: McpFileEntry[] = [{
      name: 'filesystem', enabled: true,
      config: {
        transport: 'stdio', command: 'npx.cmd',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\teste\\pilotos'], env: {}
      }
    }]

    saveMcpFile(dataDir, entries)
    const raw = JSON.parse(readFileSync(join(dataDir, 'mcp.json'), 'utf8')) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }
    expect(raw.mcpServers.filesystem).toEqual({
      command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\teste\\pilotos'], env: {}
    })
    expect(loadMcpFile(dataDir)).toEqual(entries)
  })
})
