import { ensureOk, LlmError, readSse, trimSlash, type ChatRequest, type ChatResult, type LlmClient, type ToolUseBlock } from './provider'

const apiVersion = '2023-06-01'
const maxTokens = 8192

type Event =
  | { type: 'message_start'; message: { usage?: { input_tokens?: number } } }
  | { type: 'content_block_start'; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta?: { stop_reason?: string }; usage?: { output_tokens?: number } }
  | { type: 'error'; error: { message: string } }
  | { type: string }

export class AnthropicClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null
  ) {}

  private headers(): Record<string, string> {
    if (!this.apiKey) throw new LlmError('Provedor Anthropic sem chave de API')
    return { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': apiVersion }
  }

  async chat(req: ChatRequest, onDelta: (delta: string) => void): Promise<ChatResult> {
    // Build Anthropic messages from ChatTurn[]
    const messages: unknown[] = []
    for (const m of req.messages) {
      if (m.role === 'tool') {
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }] })
      } else if (m.role === 'assistant' && m.toolUse?.length) {
        messages.push({ role: 'assistant', content: m.toolUse.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })) })
      } else {
        messages.push({ role: m.role, content: m.content })
      }
    }

    const res = await fetch(`${trimSlash(this.baseUrl)}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages,
        temperature: Math.min(req.temperature, 1),
        stream: true,
        ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {})
      }),
      signal: req.signal
    })
    await ensureOk(res, 'Anthropic')

    let text = ''
    let tokensIn: number | null = null
    let tokensOut: number | null = null
    // tool_use accumulator
    const toolBlocks: Map<number, { id: string; name: string; json: string }> = new Map()
    let stopReason = ''

    for await (const raw of readSse(res.body)) {
      const ev = raw as Event
      if (ev.type === 'message_start' && 'message' in ev) {
        tokensIn = ev.message.usage?.input_tokens ?? null
      } else if (ev.type === 'content_block_start' && 'content_block' in ev) {
        if (ev.content_block.type === 'tool_use') {
          toolBlocks.set(ev.index, { id: ev.content_block.id ?? '', name: ev.content_block.name ?? '', json: '' })
        }
      } else if (ev.type === 'content_block_delta' && 'delta' in ev) {
        if (ev.delta.type === 'text_delta' && ev.delta.text) {
          text += ev.delta.text
          onDelta(ev.delta.text)
        } else if (ev.delta.type === 'input_json_delta' && ev.delta.partial_json) {
          const block = toolBlocks.get(ev.index)
          if (block) block.json += ev.delta.partial_json
        }
      } else if (ev.type === 'message_delta' && 'delta' in ev) {
        stopReason = ev.delta?.stop_reason ?? stopReason
        tokensOut = ev.usage?.output_tokens ?? tokensOut
      } else if (ev.type === 'error' && 'error' in ev) {
        throw new LlmError(`Anthropic: ${ev.error.message}`)
      }
    }

    if (stopReason === 'tool_use' && toolBlocks.size > 0) {
      const toolUse: ToolUseBlock[] = [...toolBlocks.values()].map((b) => ({
        id: b.id, name: b.name, input: JSON.parse(b.json || '{}') as Record<string, unknown>
      }))
      return { text, tokensIn, tokensOut, toolUse }
    }
    return { text, tokensIn, tokensOut }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${trimSlash(this.baseUrl)}/v1/models?limit=100`, { headers: this.headers() })
    await ensureOk(res, 'Anthropic')
    const body = (await res.json()) as { data?: { id: string }[] }
    return (body.data ?? []).map((m) => m.id)
  }
}
