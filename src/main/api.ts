import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Db } from './db/connection'
import type { SecretStore } from './secrets'
import type { ClientFactory } from './llm'
import { listAgents } from './db/repos/agents'
import { listConversations, insertConversation, deleteConversation, listMessages } from './db/repos/conversations'
import { ChatService } from './services/chat'

export interface ApiDeps {
  db: Db
  secrets: SecretStore
  createClient: ClientFactory
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

export function startApiServer(deps: ApiDeps): void {
  const { db, secrets, createClient } = deps

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
      res.end()
      return
    }

    try {
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
