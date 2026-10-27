import { randomUUID } from 'node:crypto'
import { createServer,type IncomingMessage, type ServerResponse } from 'node:http'
import type { Db } from './db/connection'
import type { SecretStore } from './secrets'
import type { ClientFactory } from './llm'
import { listAgents, getAgent, insertAgent, updateAgent, deleteAgent } from './db/repos/agents'
import { listProviders, toPublic } from './db/repos/providers'
import { listConversations, insertConversation, deleteConversation, listMessages } from './db/repos/conversations'
import { listGeneratedPrompts } from './db/repos/prompts'
import { listFlows, listFlowRuns, listSteps } from './db/repos/flows'
import { listRoutines, listRuns } from './db/repos/routines'
import { listPages, getPage } from './db/repos/pages'
import { getSettings, saveSettings } from './db/repos/settings'
import { ChatService } from './services/chat'
import { WEB_UI } from './webui'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { webHandlers, addEventClient, DESKTOP_ONLY } from './webBridge'

const RENDERER_DIR = join(__dirname, '../renderer')
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' }

// Serve o build do renderer (a mesma interface do desktop); sem auth, são só arquivos estáticos.
async function serveStatic(res: ServerResponse, path: string): Promise<boolean> {
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path))
  if (rel.includes('..')) return false
  try {
    const body = await readFile(join(RENDERER_DIR, rel))
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream' })
    res.end(body)
    return true
  } catch {
    return false
  }
}

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

export interface ApiControl {
  setEnabled(on: boolean): void
}

const API_PORT = 3111

export function startApiServer(deps: ApiDeps): ApiControl {
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
      if (method === 'GET' && path !== '/lite' && !path.startsWith('/api/') && (await serveStatic(res, path))) return
      if (method === 'GET' && path === '/lite') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(WEB_UI)
        return
      }
      if (method === 'GET' && path === '/api/ping') {
        json(res, { ok: true })
        return
      }
      if (!checkAuth(req, getSettings(db).apiToken)) {
        error(res, 'Unauthorized', 401)
        return
      }

      // Ponte do renderer web: mesmos handlers do IPC do desktop + eventos por SSE
      if (method === 'GET' && path === '/api/events') return addEventClient(res)
      if (method === 'POST' && path === '/api/ipc') {
        const b = (await parseBody(req)) as { channel?: unknown; args?: unknown }
        const ch = typeof b.channel === 'string' ? b.channel : ''
        const fn = webHandlers.get(ch)
        if (!fn) return error(res, 'Canal desconhecido', 404)
        if (DESKTOP_ONLY.has(ch)) return error(res, 'Indisponível no navegador (função do desktop)', 400)
        return json(res, { result: (await fn(...(Array.isArray(b.args) ? b.args : []))) ?? null })
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

      if (get('/api/providers')) return json(res, listProviders(db).map(toPublic))

      const flowStepsMatch = path.match(/^\/api\/flow-runs\/(\d+)\/steps$/)
      if (method === 'GET' && flowStepsMatch) return json(res, listSteps(db, Number(flowStepsMatch[1])))

      // POST /api/agents (criar) e PUT/DELETE /api/agents/:id; campos não enviados mantêm o valor atual
      const agentMatch = path.match(/^\/api\/agents(?:\/(\d+))?$/)
      if (agentMatch && (method === 'POST' || method === 'PUT')) {
        const id = agentMatch[1] ? Number(agentMatch[1]) : null
        if ((method === 'PUT') !== (id !== null)) return error(res, 'Not found', 404)
        const cur = id !== null ? getAgent(db, id) : null
        if (id !== null && !cur) return error(res, 'Not found', 404)
        const b = (await parseBody(req)) as Record<string, unknown>
        const a = {
          name: String(b.name ?? cur?.name ?? '').trim(),
          color: cur?.color ?? '#2d6cdf',
          systemPrompt: String(b.systemPrompt ?? cur?.systemPrompt ?? ''),
          providerId: Number(b.providerId ?? cur?.providerId),
          model: String(b.model ?? cur?.model ?? '').trim(),
          temperature: Number(b.temperature ?? cur?.temperature ?? 0.7),
          usarCache: cur?.usarCache ?? false,
          mcpTools: cur?.mcpTools ?? [],
          verificarFontes: cur?.verificarFontes ?? false,
          verificadorProviderId: cur?.verificadorProviderId ?? null,
          verificadorModel: cur?.verificadorModel ?? null
        }
        if (!a.name || !a.model || !Number.isFinite(a.providerId) || !Number.isFinite(a.temperature)) return error(res, 'name, providerId, model e temperature são obrigatórios', 400)
        return json(res, id !== null ? updateAgent(db, id, a) : insertAgent(db, a))
      }
      if (method === 'DELETE' && agentMatch?.[1]) {
        deleteAgent(db, Number(agentMatch[1]))
        return json(res, { ok: true })
      }

      // só campos inofensivos: o token e a porta não mudam por aqui
      if (method === 'POST' && path === '/api/settings') {
        const b = (await parseBody(req)) as { notifyOnRun?: unknown; retentionDays?: unknown }
        const cur = getSettings(db)
        return json(res, saveSettings(db, {
          ...cur,
          notifyOnRun: typeof b.notifyOnRun === 'boolean' ? b.notifyOnRun : cur.notifyOnRun,
          retentionDays: Number.isInteger(b.retentionDays) && (b.retentionDays as number) >= 0 ? (b.retentionDays as number) : cur.retentionDays
        }))
      }

      const verificMatch = path.match(/^\/api\/verificacoes\/(\d+)$/)
      if (method === 'GET' && verificMatch) {
        const rows = db.prepare(
          `SELECT id, message_id, claim_text, source_url, source_snippet, veredito, created_at
           FROM verificacoes WHERE message_id = ? ORDER BY id`
        ).all(Number(verificMatch[1])) as {
          id: number; message_id: number; claim_text: string
          source_url: string | null; source_snippet: string | null
          veredito: string; created_at: string
        }[]
        if (rows.length === 0) return json(res, null)
        const items = rows.map((r) => ({
          id: r.id, messageId: r.message_id, claimText: r.claim_text,
          sourceUrl: r.source_url, sourceSnippet: r.source_snippet,
          veredito: r.veredito, createdAt: r.created_at
        }))
        const judged = items.filter((i) => i.veredito !== 'FONTE_INACESSIVEL')
        const correto = items.filter((i) => i.veredito === 'CORRETO').length
        return json(res, {
          messageId: Number(verificMatch[1]),
          total: items.length,
          correto, errado: items.filter((i) => i.veredito === 'ERRADO').length,
          semSuporte: items.filter((i) => i.veredito === 'SEM_SUPORTE').length,
          inacessivel: items.filter((i) => i.veredito === 'FONTE_INACESSIVEL').length,
          score: judged.length > 0 ? Math.round((correto / judged.length) * 100) : null,
          items
        })
      }

      // Not found
      error(res, 'Not found', 404)
    } catch (err) {
      error(res, String(err), 500)
    }
  })

  // Sem este handler, EADDRINUSE (porta ocupada) viraria exceção não tratada no processo principal.
  server.on('error', (err: NodeJS.ErrnoException) => console.error(`[API] falha na porta ${API_PORT}: ${err.code ?? err.message}`))

  const setEnabled = (on: boolean): void => {
    if (on && !server.listening) {
      server.listen(API_PORT, '0.0.0.0', () => console.log(`[API] escutando em 0.0.0.0:${API_PORT}`))
    } else if (!on && server.listening) {
      server.close()
      server.closeAllConnections()
      console.log('[API] desligada')
    }
  }
  setEnabled(initial.apiEnabled)
  return { setEnabled }
}
