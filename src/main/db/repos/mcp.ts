import type { McpApprovalMap, McpToolApproval } from '@shared/mcp'
import type { Db } from '../connection'
import { now } from '../connection'

export function logMcpCall(db: Db, serverName: string, toolName: string, status: 'ok' | 'error' | 'denied', durationMs?: number, error?: string): void {
  db.prepare(`INSERT INTO mcp_calls (server_name, tool_name, status, duration_ms, error, started_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(serverName, toolName, status, durationMs ?? null, error ?? null, now())
}

export function getApprovals(db: Db, agentId: number): McpApprovalMap {
  const rows = db.prepare(`SELECT server_name, tool_name, approval FROM mcp_approvals WHERE agent_id = ?`).all(agentId) as { server_name: string; tool_name: string; approval: McpToolApproval }[]
  const map: McpApprovalMap = {}
  for (const r of rows) map[`${r.server_name}::${r.tool_name}`] = r.approval
  return map
}

export function setApproval(db: Db, agentId: number, serverName: string, toolName: string, approval: McpToolApproval): void {
  db.prepare(`INSERT INTO mcp_approvals (agent_id, server_name, tool_name, approval) VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id, server_name, tool_name) DO UPDATE SET approval = excluded.approval`)
    .run(agentId, serverName, toolName, approval)
}

export function removeApproval(db: Db, agentId: number, serverName: string, toolName: string): void {
  db.prepare('DELETE FROM mcp_approvals WHERE agent_id = ? AND server_name = ? AND tool_name = ?')
    .run(agentId, serverName, toolName)
}

export function listApprovalRules(db: Db, agentId: number): { serverName: string; toolName: string; approval: McpToolApproval }[] {
  const rows = db.prepare('SELECT server_name, tool_name, approval FROM mcp_approvals WHERE agent_id = ? ORDER BY server_name, tool_name')
    .all(agentId) as { server_name: string; tool_name: string; approval: McpToolApproval }[]
  return rows.map((row) => ({ serverName: row.server_name, toolName: row.tool_name, approval: row.approval }))
}
