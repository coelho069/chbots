import { randomUUID } from 'node:crypto'
import { createServer,type IncomingMessage, type ServerResponse } from 'node:http'
import type { Db } from './db/connection'
import type { SecretStore } from './secrets'
import type { ClientFactory } from './llm'
import { listAgents } from './db/repos/agents'
import { listConversations, insertConversation, deleteConversation, listMessages } from './db/repos/conversations'
import { listGeneratedPrompts } from './db/repos/prompts'
import { listFlows, listFlowRuns } from './db/repos/flows'
import { listRoutines, listRuns } from './db/repos/routines'
import { listPages, getPage } from './db/repos/pages'
import { getSettings, saveSettings } from './db/repos/settings'
import { ChatService } from './services/chat'

export interface ApiDeps {
  db: Db
  secrets: SecretStore
  createClient: ClientFactory
  flowRunner?: { start(flowId: number, trigger: 'manual'): { run: unknown; done: Promise<unknown> } }
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

function error(res: ServerResponse, message: string, status = 500): void {
  json(res, { error: message }, status)
}

function checkAuth(req: IncomingMessage, token: string): boolean {
  return token !== '' && req.headers.authorization === `Bearer ${token}`
}

export function startApiServer(deps: ApiDeps): void {
  const { db, secrets, createClient, flowRunner } = deps
  const initial = getSettings(db)
  if (initial.apiToken === '') saveSettings(db, { ...initial, apiToken: randomUUID() })

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      })
      res.end()
      return
    }

    try {
      if (method === 'GET' && path === '/api/ping') {
        json(res, { ok: true })
        return
      }
      if (!checkAuth(req, getSettings(db).apiToken)) {
        error(res, 'Unauthorized', 401)
        return
      }

      // GET /api/agents
      if (method === 'GET' && path === '/api/agents') {
        const agents = listAgents(db)
        json(res, agents)
        return
      }

      // GET /api/conversations/:agentId
      const convMatch = path.match(/^\/api\/conversations\/(\d+)$/)
      if (method === 'GET' && convMatch && !path.includes('/messages')) {
        const agentId = Number(convMatch[1])
        const conversations = listConversations(db, agentId)
        json(res, conversations)
        return
      }

      // POST /api/conversations
      if (method === 'POST' && path === '/api/conversations') {
        const body = (await parseBody(req)) as { agentId?: number }
        if (!body.agentId) {
          error(res, 'agentId required', 400)
          return
        }
        const conversation = insertConversation(db, body.agentId, 'manual')
        json(res, conversation)
        return
      }

      // DELETE /api/conversations/:id
      const delMatch = path.match(/^\/api\/conversations\/(\d+)$/)
      if (method === 'DELETE' && delMatch) {
        const id = Number(delMatch[1])
        deleteConversation(db, id)
        json(res, { ok: true })
        return
      }

      // GET /api/conversations/:id/messages
      const msgMatch = path.match(/^\/api\/conversations\/(\d+)\/messages$/)
      if (method === 'GET' && msgMatch) {
        const id = Number(msgMatch[1])
        const messages = listMessages(db, id)
        json(res, messages)
        return
      }

      // POST /api/conversations/:id/chat (SSE stream)
      const chatMatch = path.match(/^\/api\/conversations\/(\d+)\/chat$/)
      if (method === 'POST' && chatMatch) {
        const conversationId = Number(chatMatch[1])
        const body = (await parseBody(req)) as { text?: string }
        if (!body.text) {
          error(res, 'text required', 400)
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        })

        const chatService = new ChatService({
          db,
          secrets,
          createClient,
          onChunk: (chunk) => {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`)
          }
        })

        try {
          await chatService.send(conversationId, body.text)
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        } catch (err) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`)
        }
        res.end()
        return
      }

      const get = (p: string): boolean => method === 'GET' && path === p
      if (get('/api/prompts')) return json(res, listGeneratedPrompts(db))
      if (get('/api/flows')) return json(res, listFlows(db))
      if (get('/api/routines')) return json(res, listRoutines(db))
      if (get('/api/routine-runs')) return json(res, listRuns(db, null))
      if (get('/api/pages')) return json(res, listPages(db))
      if (get('/api/settings')) return json(res, getSettings(db))
      // colunas reais do schema (migrations.ts), não as do briefing
      if (get('/api/mcp/calls')) return json(res, db.prepare('SELECT * FROM mcp_calls ORDER BY started_at DESC LIMIT 200').all())
      if (get('/api/memoria/fatos')) return json(res, db.prepare('SELECT * FROM memoria_fatos ORDER BY criado_em DESC LIMIT 100').all())
      if (get('/api/blackbox')) {
        return json(res, db.prepare(`
          SELECT * FROM (
            SELECT 'fluxo' as tipo, fr.id as execucaoId, f.name as nome, fr.status, NULL as agentId, f.id as fluxoId,
                   fr.started_at as iniciadoEm, fr.finished_at as finalizadoEm, fr.error as erro
            FROM flow_runs fr JOIN flows f ON f.id = fr.flow_id
            UNION ALL
            SELECT 'rotina', rr.id, r.name, rr.status, r.source_agent_id, NULL,
                   rr.started_at, rr.finished_at, rr.error
            FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id
          ) ORDER BY iniciadoEm DESC LIMIT 200
        `).all())
      }

      const routineRunsMatch = path.match(/^\/api\/routine-runs\/(\d+)$/)
      if (method === 'GET' && routineRunsMatch) return json(res, listRuns(db, Number(routineRunsMatch[1])))

      const pageMatch = path.match(/^\/api\/pages\/(\d+)$/)
      if (method === 'GET' && pageMatch) {
        const page = getPage(db, Number(pageMatch[1]))
        return page ? json(res, page) : error(res, 'Not found', 404)
      }

      const flowRunsMatch = path.match(/^\/api\/flows\/(\d+)\/runs$/)
      if (method === 'GET' && flowRunsMatch) return json(res, listFlowRuns(db, Number(flowRunsMatch[1])))

      const flowRunMatch = path.match(/^\/api\/flows\/(\d+)\/run$/)
      if (method === 'POST' && flowRunMatch) {
        if (!flowRunner) return error(res, 'Flow runner unavailable', 501)
        return json(res, flowRunner.start(Number(flowRunMatch[1]), 'manual').run)
      }

      // Not found
      error(res, 'Not found', 404)
    } catch (err) {
      error(res, String(err), 500)
    }
  })

  server.listen(3111, '0.0.0.0', () => {
    console.log('API server listening on 0.0.0.0:3111')
  })
}
