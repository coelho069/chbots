import { ensureOk, readSse, trimSlash, type ChatRequest, type ChatResult, type ContentBlock, type LlmClient, type ToolUseBlock } from './provider'

interface Chunk {
  choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

interface NonStreamChunk {
  choices?: { message?: { content?: string | null; tool_calls?: { id: string; function?: { name: string; arguments: string } }[] }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

// Qualquer API no formato /chat/completions (OpenAI, OpenRouter, Groq, LM Studio...).
export class OpenAiCompatClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`
    return h
  }

  async chat(req: ChatRequest, onDelta: (delta: string) => void): Promise<ChatResult> {
    // Build OpenAI message array from ChatTurn[]
    const messages: unknown[] = req.system ? [{ role: 'system', content: req.system }] : []
    for (const m of req.messages) {
      if (m.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content })
      } else if (m.role === 'assistant' && m.toolUse?.length) {
        messages.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolUse.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input) } }))
        })
      } else if (Array.isArray(m.content)) {
        const oaiContent = (m.content as ContentBlock[]).map((b) =>
          b.type === 'text'
            ? { type: 'text' as const, text: b.text }
            : { type: 'image_url' as const, image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
        )
        messages.push({ role: m.role, content: oaiContent })
      } else {
        messages.push({ role: m.role, content: m.content })
      }
    }

    const useStream = req.streaming !== false
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      temperature: req.temperature,
      stream: useStream,
      ...(useStream ? { stream_options: { include_usage: true } } : {}),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })), tool_choice: 'auto' } : {})
    }

    const res = await fetch(`${trimSlash(this.baseUrl)}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: req.signal
    })
    await ensureOk(res, 'API')

    if (!useStream) {
      const json = await res.json() as NonStreamChunk
      const msg = json.choices?.[0]?.message
      const toolCalls = msg?.tool_calls
      if (toolCalls?.length) {
        const toolUse: ToolUseBlock[] = toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function?.name ?? '',
          input: JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>
        }))
        return { text: '', tokensIn: json.usage?.prompt_tokens ?? null, tokensOut: json.usage?.completion_tokens ?? null, toolUse }
      }
      const text = msg?.content ?? ''
      // Stream the final text ourselves so onDelta fires
      onDelta(text)
      return { text, tokensIn: json.usage?.prompt_tokens ?? null, tokensOut: json.usage?.completion_tokens ?? null }
    }

    let text = ''
    let tokensIn: number | null = null
    let tokensOut: number | null = null
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    for await (const raw of readSse(res.body)) {
      const chunk = raw as Chunk
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) { text += delta; onDelta(delta) }
      for (const call of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
        const current = toolCalls.get(call.index) ?? { id: '', name: '', arguments: '' }
        if (call.id) current.id = call.id
        if (call.function?.name) current.name += call.function.name
        if (call.function?.arguments) current.arguments += call.function.arguments
        toolCalls.set(call.index, current)
      }
      if (chunk.usage) { tokensIn = chunk.usage.prompt_tokens ?? tokensIn; tokensOut = chunk.usage.completion_tokens ?? tokensOut }
    }
    if (toolCalls.size > 0) {
      return {
        text,
        tokensIn,
        tokensOut,
        toolUse: [...toolCalls.values()].map((call) => ({
          id: call.id,
          name: call.name,
          input: JSON.parse(call.arguments || '{}') as Record<string, unknown>
        }))
      }
    }
    return { text, tokensIn, tokensOut }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${trimSlash(this.baseUrl)}/models`, { headers: this.headers() })
    await ensureOk(res, 'API')
    const body = (await res.json()) as { data?: { id: string }[] }
    return (body.data ?? []).map((m) => m.id).sort()
  }
}
