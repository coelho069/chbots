import { describe, expect, it, vi } from 'vitest'
import type { McpApprovalRequest } from '../src/shared/mcp'
import { mcpApprovalInput, mcpToolRefInput } from '../src/shared/schemas'
import { getApprovals, setApproval } from '../src/main/db/repos/mcp'
import { McpService } from '../src/main/services/mcp'
import { setup } from './helpers'

function makeService(onApprovalRequest: (request: McpApprovalRequest) => void) {
  const service = new McpService({
    onStatusChanged: vi.fn(),
    onApprovalRequest,
    onToolCall: vi.fn()
  })
  const client = {
    callTool: vi.fn(async ({ name }: { name: string }) => ({
      content: [{ type: 'text', text: `resultado:${name}` }],
      isError: false
    }))
  }
  ;(service as any).entries.set('filesystem', {
    configKey: 'test',
    client,
    info: {
      name: 'filesystem',
      config: { transport: 'stdio', command: 'test', args: [], env: {} },
      enabled: true,
      status: 'connected',
      tools: [],
      resources: [],
      prompts: []
    }
  })
  return { service, client }
}

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('evento MCP não recebido')
}

describe('aprovação MCP', () => {
  it('mantém múltiplas pendências independentes na mesma conversa', async () => {
    const requests: McpApprovalRequest[] = []
    const { service, client } = makeService((request) => requests.push(request))

    const first = service.callTool('filesystem', 'list_directory', { path: 'D:\\teste' }, {
      conversationId: 42,
      requireApproval: true
    })
    const second = service.callTool('filesystem', 'read_text_file', { path: 'D:\\teste\\a.txt' }, {
      conversationId: 42,
      requireApproval: true
    })

    await waitFor(() => requests.length === 2 ? requests : undefined)
    expect(new Set(requests.map((request) => request.requestId)).size).toBe(2)
    expect(requests.every((request) => request.conversationId === 42)).toBe(true)
    expect(client.callTool).not.toHaveBeenCalled()

    for (const request of requests) service.respondApproval(request.requestId, true)
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(client.callTool).toHaveBeenCalledTimes(2)
  })

  it('permite aprovar em lote as pendências da conversa sem aprovar outra conversa', async () => {
    const requests: McpApprovalRequest[] = []
    const { service } = makeService((request) => requests.push(request))
    const inConversation = [
      service.callTool('filesystem', 'one', {}, { conversationId: 7, requireApproval: true }),
      service.callTool('filesystem', 'two', {}, { conversationId: 7, requireApproval: true })
    ]
    const otherConversation = service.callTool('filesystem', 'three', {}, { conversationId: 8, requireApproval: true })
      .then(() => null, (error) => error as Error)

    await waitFor(() => requests.length === 3 ? requests : undefined)
    for (const request of requests.filter((item) => item.conversationId === 7)) {
      service.respondApproval(request.requestId, true)
    }
    await expect(Promise.all(inConversation)).resolves.toHaveLength(2)

    // A pendência de outra conversa continua aguardando decisão.
    let settled = false
    void otherConversation.then(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    const remaining = requests.find((item) => item.conversationId === 8)!
    service.respondApproval(remaining.requestId, false)
    await expect(otherConversation).resolves.toMatchObject({ message: expect.stringContaining('negada') })
  })

  it('persiste a política sempre aprovar e atualiza a decisão por ferramenta', () => {
    const { db, agent } = setup()
    const owner = agent('A')

    expect(getApprovals(db, owner.id)).toEqual({})
    setApproval(db, owner.id, 'filesystem', 'read_file', 'allow')
    expect(getApprovals(db, owner.id)).toEqual({ 'filesystem::read_file': 'allow' })

    setApproval(db, owner.id, 'filesystem', 'read_file', 'block')
    expect(getApprovals(db, owner.id)).toEqual({ 'filesystem::read_file': 'block' })
  })

  it('mantém compatibilidade e limites dos payloads de aprovação IPC', () => {
    const validRequest = { requestId: '123e4567-e89b-12d3-a456-426614174000', approved: true }
    expect(mcpApprovalInput.parse(validRequest)).toEqual(validRequest)
    expect(mcpApprovalInput.safeParse({ ...validRequest, requestId: 'not-a-uuid' }).success).toBe(false)
    expect(mcpApprovalInput.safeParse({ ...validRequest, approved: 'true' }).success).toBe(false)

    expect(mcpToolRefInput.parse({ serverName: 'f'.repeat(80), toolName: 't'.repeat(200) })).toEqual({
      serverName: 'f'.repeat(80),
      toolName: 't'.repeat(200)
    })
    expect(mcpToolRefInput.safeParse({ serverName: '', toolName: 'tool' }).success).toBe(false)
    expect(mcpToolRefInput.safeParse({ serverName: 'f'.repeat(81), toolName: 'tool' }).success).toBe(false)
    expect(mcpToolRefInput.safeParse({ serverName: 'server', toolName: 't'.repeat(201) }).success).toBe(false)
  })

  it('não aceita políticas fora de ask, allow e block no armazenamento', () => {
    const { db, agent } = setup()
    const owner = agent('A')
    expect(() => db.prepare(
      `INSERT INTO mcp_approvals (agent_id, server_name, tool_name, approval) VALUES (?, 's', 't', 'invalid')`
    ).run(owner.id)).toThrow()
  })
})
