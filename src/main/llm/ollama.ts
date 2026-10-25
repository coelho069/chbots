import { ensureOk, LlmError, readLines, trimSlash, type ChatRequest, type ChatResult, type LlmClient } from './provider'

interface Line {
  message?: { content?: string }
  done?: boolean
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

// Modelos locais via Ollama (sem chave).
export class OllamaClient implements LlmClient {
  constructor(private readonly baseUrl: string) {}

  async chat(req: ChatRequest, onDelta: (delta: string) => void): Promise<ChatResult> {
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages]
    const res = await fetch(`${trimSlash(this.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: req.model, messages, stream: true, options: { temperature: req.temperature } }),
      signal: req.signal
    })
    await ensureOk(res, 'Ollama')

    let text = ''
    let tokensIn: number | null = null
    let tokensOut: number | null = null
    for await (const raw of readLines(res.body)) {
      if (raw.trim() === '') continue
      const line = JSON.parse(raw) as Line
      if (line.error) throw new LlmError(`Ollama: ${line.error}`)
      const delta = line.message?.content
      if (delta) {
        text += delta
        onDelta(delta)
      }
      if (line.done) {
        tokensIn = line.prompt_eval_count ?? null
        tokensOut = line.eval_count ?? null
      }
    }
    return { text, tokensIn, tokensOut }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${trimSlash(this.baseUrl)}/api/tags`)
    await ensureOk(res, 'Ollama')
    const body = (await res.json()) as { models?: { name: string }[] }
    return (body.models ?? []).map((m) => m.name).sort()
  }
}
