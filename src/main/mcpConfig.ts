import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { McpServerConfig } from '@shared/mcp'

// Valor secreto em disco: "__secret__:<base64>". Em memória: texto puro.
const SECRET_PREFIX = '__secret__:'

export function encryptEnvValue(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) return plain
  return SECRET_PREFIX + safeStorage.encryptString(plain).toString('base64')
}

export function decryptEnvValue(stored: string): string {
  if (!stored.startsWith(SECRET_PREFIX)) return stored
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

// Redact: nunca expõe valores secretos em logs ou no renderer.
export function redactConfig(cfg: McpServerConfig): McpServerConfig {
  if (cfg.transport !== 'stdio') return cfg
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfg.env)) env[k] = v.startsWith(SECRET_PREFIX) ? '***' : v
  return { ...cfg, env }
}

export interface McpFileEntry {
  name: string
  enabled: boolean
  config: McpServerConfig
}

interface RawMcpJson {
  mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }>
}

export function loadMcpFile(dataDir: string): McpFileEntry[] {
  const path = join(dataDir, 'mcp.json')
  if (!existsSync(path)) return []
  try {
    const raw: RawMcpJson = JSON.parse(readFileSync(path, 'utf8'))
    const entries: McpFileEntry[] = []
    for (const [name, srv] of Object.entries(raw.mcpServers ?? {})) {
      if (srv.url) {
        entries.push({ name, enabled: true, config: { transport: 'http', url: srv.url, headers: srv.headers ?? {} } })
      } else if (srv.command) {
        entries.push({ name, enabled: true, config: { transport: 'stdio', command: srv.command, args: srv.args ?? [], env: srv.env ?? {} } })
      }
    }
    return entries
  } catch {
    return []
  }
}

export function saveMcpFile(dataDir: string, entries: McpFileEntry[]): void {
  const servers: Record<string, unknown> = {}
  for (const e of entries) {
    const cfg = e.config
    if (cfg.transport === 'http') {
      servers[e.name] = { url: cfg.url, ...(cfg.headers && Object.keys(cfg.headers).length ? { headers: cfg.headers } : {}) }
    } else {
      servers[e.name] = { command: cfg.command, args: cfg.args, env: cfg.env }
    }
  }
  writeFileSync(join(dataDir, 'mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2), 'utf8')
}

// Import from Claude Desktop / Cursor format (same mcp.json shape).
export function importFromFile(filePath: string): McpFileEntry[] {
  const raw: RawMcpJson = JSON.parse(readFileSync(filePath, 'utf8'))
  const entries: McpFileEntry[] = []
  for (const [name, srv] of Object.entries(raw.mcpServers ?? {})) {
    if (srv.url) {
      entries.push({ name, enabled: false, config: { transport: 'http', url: srv.url, headers: srv.headers ?? {} } })
    } else if (srv.command) {
      entries.push({ name, enabled: false, config: { transport: 'stdio', command: srv.command, args: srv.args ?? [], env: srv.env ?? {} } })
    }
  }
  return entries
}
