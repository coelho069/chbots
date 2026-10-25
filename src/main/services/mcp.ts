import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpApprovalRequest, McpCallResult, McpServerInfo, McpToolDef } from '@shared/mcp'
import type { McpFileEntry } from '../mcpConfig'
import { decryptEnvValue, redactConfig } from '../mcpConfig'

const TOOL_TIMEOUT_MS = 30_000
const RECONNECT_DELAYS = [2_000, 5_000, 10_000]

function configKey(config: McpFileEntry['config']): string {
  return JSON.stringify(config)
}

export interface McpServiceDeps {
  onStatusChanged: () => void
  onApprovalRequest: (req: McpApprovalRequest) => void
  onToolCall: (event: { conversationId: number; serverName: string; toolName: string; args: Record<string, unknown>; result?: McpCallResult; status: 'calling' | 'done' | 'error' | 'denied' }) => void
  onOfficeEvent?: (ev: import('@shared/office').OfficeEvent) => void
  translateTools?: (serverName: string, tools: McpToolDef[]) => Promise<McpToolDef[]>
}

interface Entry {
  info: McpServerInfo
  configKey: string
  client?: Client
  reconnectTimer?: ReturnType<typeof setTimeout>
}

interface CapabilitiesSnapshot {
  tools: McpToolDef[]
  resources: { uri: string; name: string; description?: string }[]
  prompts: { name: string; description?: string }[]
}

// Pending approval: resolve(true/false) when renderer responds.
interface PendingApproval {
  resolve: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
  startedAt: number
  request: McpApprovalRequest
  agentId?: number
}

export class McpService {
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, PendingApproval>()
  private readonly approvalAllConversations = new Set<number>()
  private readonly capabilitiesCache = new Map<string, CapabilitiesSnapshot>()

  constructor(private readonly deps: McpServiceDeps) {}

  // ---- Lifecycle ----

  async loadAll(fileEntries: McpFileEntry[]): Promise<void> {
    // Remove servers not in file anymore
    await Promise.all([...this.entries.keys()]
      .filter((name) => !fileEntries.some((e) => e.name === name))
      .map((name) => this.disconnect(name)))

    const toConnect: string[] = []
    for (const fe of fileEntries) {
      const existing = this.entries.get(fe.name)
      if (existing) {
        const changed = existing.configKey !== configKey(fe.config)
        existing.info.enabled = fe.enabled
        existing.info.config = fe.config
        existing.configKey = configKey(fe.config)
        if (!fe.enabled && existing.client) await this.disconnect(fe.name)
        else if (fe.enabled && (changed || !existing.client)) {
          if (changed && existing.client) await this.disconnect(fe.name)
          toConnect.push(fe.name)
        }
      } else {
        this.entries.set(fe.name, {
          configKey: configKey(fe.config),
          info: { name: fe.name, config: fe.config, enabled: fe.enabled, status: 'off', tools: [], resources: [], prompts: [] }
        })
        if (fe.enabled) toConnect.push(fe.name)
      }
    }

    // Connections are independent. Start them together without blocking the caller
    // on a slow server, while keeping one client and one capability snapshot per entry.
    await Promise.allSettled(toConnect.map((name) => this.connect(name)))
  }

  async connect(name: string): Promise<void> {
    const entry = this.entries.get(name)
    if (!entry) return
    if (entry.client) await this.disconnect(name)
    entry.info.status = 'connecting'
    entry.info.error = undefined
    this.deps.onStatusChanged()
    const startedAt = Date.now()
    try {
      const cfg = entry.info.config
      let transport
      if (cfg.transport === 'stdio') {
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(cfg.env)) env[k] = decryptEnvValue(v)
        transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: { ...process.env as Record<string, string>, ...env }
        })
      } else {
        transport = new StreamableHTTPClientTransport(new URL(cfg.url))
      }
      const client = new Client({ name: 'ch-bots', version: '1.0.0' })
      await client.connect(transport)
      entry.client = client
      clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = undefined
      entry.info.status = 'connected'
      await this.refreshCapabilities(name)
      console.info(`[MCP] connect server=${name} status=connected durationMs=${Date.now() - startedAt} tools=${entry.info.tools.length}`)
      this.deps.onStatusChanged()
      if (this.deps.translateTools) void this.translateTools(name)
    } catch (err) {
      entry.info.status = 'error'
      entry.info.error = err instanceof Error ? err.message : String(err)
      entry.info.tools = []
      console.warn(`[MCP] connect server=${name} status=error durationMs=${Date.now() - startedAt} error=${entry.info.error}`)
      this.deps.onStatusChanged()
      this.scheduleReconnect(name, 0)
    }
  }

  private async translateTools(name: string): Promise<void> {
    const entry = this.entries.get(name)
    if (!entry || !this.deps.translateTools || entry.info.tools.length === 0) return
    entry.info.tools = entry.info.tools.map((tool) => ({ ...tool, translationStatus: 'translating' as const, translationError: undefined }))
    this.deps.onStatusChanged()
    let tools: McpToolDef[]
    try {
      tools = await this.deps.translateTools(name, entry.info.tools)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      tools = entry.info.tools.map((tool) => ({ ...tool, descriptionPtBr: tool.description, inputSchemaPtBr: tool.inputSchema, translationStatus: 'original' as const, translationError: message }))
    }
    const current = this.entries.get(name)
    if (!current || current.info.status !== 'connected') return
    current.info.tools = tools
    this.deps.onStatusChanged()
  }

  async retranslateAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((name) => this.translateTools(name)))
  }

  async disconnect(name: string): Promise<void> {
    const entry = this.entries.get(name)
    if (!entry) return
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = undefined
    try { await entry.client?.close() } catch {}
    entry.client = undefined
    // A reconnect is the cache boundary: listTools is fetched once for the
    // new client, then reused until that client is disconnected again.
    this.capabilitiesCache.delete(name)
    entry.info.status = 'off'
    entry.info.tools = []
    this.deps.onStatusChanged()
  }

  async restart(name: string): Promise<void> {
    await this.disconnect(name)
    const entry = this.entries.get(name)
    if (entry) { entry.info.enabled = true; await this.connect(name) }
  }

  private scheduleReconnect(name: string, attempt: number): void {
    const entry = this.entries.get(name)
    if (!entry || !entry.info.enabled) return
    const delay = RECONNECT_DELAYS[attempt] ?? RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1]!
    entry.reconnectTimer = setTimeout(() => {
      if (entry.info.enabled) void this.connect(name).catch(() => this.scheduleReconnect(name, attempt + 1))
    }, delay)
  }

  private async refreshCapabilities(name: string): Promise<void> {
    const entry = this.entries.get(name)
    if (!entry?.client) return
    const cached = this.capabilitiesCache.get(name)
    if (cached) {
      entry.info.tools = cached.tools.map((tool) => ({ ...tool }))
      entry.info.resources = cached.resources.map((resource) => ({ ...resource }))
      entry.info.prompts = cached.prompts.map((prompt) => ({ ...prompt }))
      console.info(`[MCP] listTools server=${name} status=cache-hit tools=${entry.info.tools.length}`)
      return
    }
    const startedAt = Date.now()
    try {
      const [toolsRes, resourcesRes, promptsRes] = await Promise.allSettled([
        entry.client.listTools(),
        entry.client.listResources(),
        entry.client.listPrompts()
      ])
      entry.info.tools = toolsRes.status === 'fulfilled'
        ? (toolsRes.value.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>
          } satisfies McpToolDef))
        : []
      entry.info.resources = resourcesRes.status === 'fulfilled'
        ? (resourcesRes.value.resources ?? []).map((r) => ({ uri: r.uri, name: r.name ?? r.uri, description: r.description }))
        : []
      entry.info.prompts = promptsRes.status === 'fulfilled'
        ? (promptsRes.value.prompts ?? []).map((p) => ({ name: p.name, description: p.description }))
        : []
      this.capabilitiesCache.set(name, {
        tools: entry.info.tools.map((tool) => ({ ...tool })),
        resources: entry.info.resources.map((resource) => ({ ...resource })),
        prompts: entry.info.prompts.map((prompt) => ({ ...prompt }))
      })
      console.info(`[MCP] listTools server=${name} status=${toolsRes.status} durationMs=${Date.now() - startedAt} tools=${entry.info.tools.length}`)
    } catch (error) {
      console.warn(`[MCP] listTools server=${name} status=error durationMs=${Date.now() - startedAt} error=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- Query ----

  list(): McpServerInfo[] {
    return [...this.entries.values()].map((e) => ({
      ...e.info,
      config: redactConfig(e.info.config)
    }))
  }

  getTools(refs: { serverName: string; toolName: string }[]): { serverName: string; tool: McpToolDef }[] {
    const result: { serverName: string; tool: McpToolDef }[] = []
    for (const ref of refs) {
      const entry = this.entries.get(ref.serverName)
      if (!entry || entry.info.status !== 'connected') continue
      const tool = entry.info.tools.find((t) => t.name === ref.toolName)
      if (tool) result.push({ serverName: ref.serverName, tool })
    }
    return result
  }

  // ---- Tool execution ----

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    opts: { conversationId?: number; requireApproval?: boolean; approvalKey?: string; botId?: number } = {}
  ): Promise<McpCallResult> {
    const entry = this.entries.get(serverName)
    if (!entry?.client || entry.info.status !== 'connected') throw new Error(`Servidor MCP "${serverName}" não está conectado`)

    const conversationId = opts.conversationId ?? 0

    const conversationAlreadyApproved = opts.conversationId != null && this.approvalAllConversations.has(conversationId)
    if (opts.requireApproval && !conversationAlreadyApproved) {
      if (opts.botId != null) {
        this.deps.onOfficeEvent?.({ botId: opts.botId, state: 'approval', tool: toolName, ts: Date.now() })
      }
      const approved = await this.requestApproval({ serverName, toolName, args, conversationId }, opts.botId)
      if (!approved) {
        if (opts.conversationId != null) {
          this.deps.onToolCall({ conversationId, serverName, toolName, args, status: 'denied' })
        }
        throw new Error(`Chamada à ferramenta "${toolName}" negada pelo usuário`)
      }
    }

    if (opts.botId != null) {
      this.deps.onOfficeEvent?.({ botId: opts.botId, state: 'tool', tool: toolName, ts: Date.now() })
    }
    if (opts.conversationId != null) {
      this.deps.onToolCall({ conversationId, serverName, toolName, args, status: 'calling' })
    }

    const start = Date.now()
    console.info(`[MCP] chamando ${serverName}.${toolName}`)
    const signal = AbortSignal.timeout(TOOL_TIMEOUT_MS)
    try {
      const res = await entry.client.callTool({ name: toolName, arguments: args }, undefined, { signal })
      const content = ((res.content ?? []) as { type: string; text?: string }[])
        .map((c: { type: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
        .join('\n')
      const result: McpCallResult = { content, isError: res.isError === true, durationMs: Date.now() - start }
      console.info(`[MCP] ${serverName}.${toolName} concluída em ${result.durationMs}ms`)
      if (opts.conversationId != null) {
        this.deps.onToolCall({ conversationId, serverName, toolName, args, result, status: res.isError ? 'error' : 'done' })
      }
      return result
    } catch (err) {
      const message = signal.aborted ? `Tempo limite da ferramenta MCP excedido (30s)` : (err instanceof Error ? err.message : String(err))
      const result: McpCallResult = { content: message, isError: true, durationMs: Date.now() - start }
      console.warn(`[MCP] ${serverName}.${toolName} falhou após ${result.durationMs}ms: ${result.content}`)
      if (opts.conversationId != null) {
        this.deps.onToolCall({ conversationId, serverName, toolName, args, result, status: 'error' })
      }
      throw new Error(message)
    }
  }

  private requestApproval(req: Omit<McpApprovalRequest, 'requestId'>, agentId?: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const requestId = randomUUID()
      const startedAt = Date.now()
      console.info(`[MCP] aguardando aprovação para ${req.serverName}.${req.toolName}`)
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        console.info(`[MCP] aprovação expirada para ${req.serverName}.${req.toolName} após ${Date.now() - startedAt}ms`)
        resolve(false)
      }, TOOL_TIMEOUT_MS)
      const request = { requestId, ...req }
      this.pending.set(requestId, { resolve, timer, startedAt, request, agentId })
      this.deps.onApprovalRequest({ ...request, agentId })
    })
  }

  respondApproval(requestId: string, approved: boolean): void {
    const p = this.pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    console.info(`[MCP] aprovação ${approved ? 'concedida' : 'negada'} após ${Date.now() - p.startedAt}ms`)
    p.resolve(approved)
  }

  listPendingApprovals(): (McpApprovalRequest & { agentId?: number })[] {
    return [...this.pending.values()].map((pending) => ({ ...pending.request, agentId: pending.agentId }))
  }

  respondApprovals(approved: boolean, filter?: (pending: PendingApproval) => boolean): number {
    const matches = [...this.pending.entries()].filter(([, pending]) => !filter || filter(pending))
    for (const [requestId, pending] of matches) {
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.resolve(approved)
    }
    if (matches.length) console.info(`[MCP] aprovações em lote=${matches.length} decisão=${approved ? 'aprovar' : 'recusar'}`)
    return matches.length
  }

  setConversationApproval(conversationId: number, approved: boolean): number {
    if (approved) this.approvalAllConversations.add(conversationId)
    else this.approvalAllConversations.delete(conversationId)
    return this.respondApprovals(approved, (pending) => pending.request.conversationId === conversationId)
  }

  respondApprovalForTool(agentId: number, serverName: string, toolName: string, approved: boolean): number {
    return this.respondApprovals(approved, (pending) => pending.agentId === agentId && pending.request.serverName === serverName && pending.request.toolName === toolName)
  }

  async stopAll(): Promise<void> {
    for (const name of this.entries.keys()) await this.disconnect(name)
  }
}
