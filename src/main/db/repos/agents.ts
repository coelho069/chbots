import type { Agent, AgentInput } from '@shared/types'
import { now, type Db } from '../connection'
import { LruCache } from '../../cache/lru'

const agentListCache = new LruCache<'list', Agent[]>(1)
const agentByIdCache = new LruCache<number, Agent>(500)

interface Row {
  id: number
  name: string
  color: string
  system_prompt: string
  provider_id: number
  model: string
  temperature: number
  usar_cache: number
  mcp_tools: string
  created_at: string
  updated_at: string
}

const toAgent = (r: Row): Agent => ({
  id: r.id,
  name: r.name,
  color: r.color,
  systemPrompt: r.system_prompt,
  providerId: r.provider_id,
  model: r.model,
  temperature: r.temperature,
  usarCache: r.usar_cache === 1,
  mcpTools: JSON.parse(r.mcp_tools ?? '[]') as Agent['mcpTools'],
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listAgents(db: Db): Agent[] {
  const cached = agentListCache.get('list')
  if (cached) return cached
  const result = (db.prepare('SELECT * FROM agents ORDER BY name COLLATE NOCASE').all() as unknown as Row[]).map(toAgent)
  agentListCache.set('list', result)
  return result
}

export function getAgent(db: Db, id: number): Agent | null {
  const cached = agentByIdCache.get(id)
  if (cached) return cached
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Row | undefined
  const agent = row ? toAgent(row) : null
  if (agent) agentByIdCache.set(id, agent)
  return agent
}

function invalidateAgentCache(id?: number): void {
  agentListCache.clear()
  if (id !== undefined) agentByIdCache.delete(id)
}

export function insertAgent(db: Db, a: AgentInput): Agent {
  const ts = now()
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO agents (name, color, system_prompt, provider_id, model, temperature, usar_cache, mcp_tools, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(a.name, a.color, a.systemPrompt, a.providerId, a.model, a.temperature, a.usarCache ? 1 : 0, JSON.stringify(a.mcpTools ?? []), ts, ts)
  invalidateAgentCache()
  return getAgent(db, Number(lastInsertRowid))!
}

export function updateAgent(db: Db, id: number, a: AgentInput): Agent {
  db.prepare(
    `UPDATE agents SET name = ?, color = ?, system_prompt = ?, provider_id = ?, model = ?, temperature = ?, usar_cache = ?, mcp_tools = ?, updated_at = ?
     WHERE id = ?`
  ).run(a.name, a.color, a.systemPrompt, a.providerId, a.model, a.temperature, a.usarCache ? 1 : 0, JSON.stringify(a.mcpTools ?? []), now(), id)
  invalidateAgentCache(id)
  return getAgent(db, id)!
}

export function deleteAgent(db: Db, id: number): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  invalidateAgentCache(id)
}
