import type { ProviderKind } from '@shared/types'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string | ContentBlock[]
  // Only for role='tool': tool call id this result answers
  toolCallId?: string
  // Only for role='assistant': tool_use blocks requested by the model
  toolUse?: ToolUseBlock[]
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolUseBlock {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  system: string
  messages: ChatTurn[]
  temperature: number
  signal?: AbortSignal
  // When provided the model may return toolUse instead of text
  tools?: ToolDef[]
  streaming?: boolean
}

export interface ChatResult {
  text: string
  tokensIn: number | null
  tokensOut: number | null
  // Set when model requests tool call(s) (non-streaming round)
  toolUse?: ToolUseBlock[]
}

export interface LlmClient {
  chat(req: ChatRequest, onDelta: (delta: string) => void): Promise<ChatResult>
  listModels(): Promise<string[]>
}

export interface ClientConfig {
  kind: ProviderKind
  baseUrl: string
  apiKey: string | null
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmError'
  }
}

export async function ensureOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 500)
  } catch {
    // corpo ilegível; fica só o status
  }
  throw new LlmError(`${provider} respondeu ${res.status}${detail ? `: ${detail}` : ''}`)
}

// Lê o corpo da resposta linha a linha (SSE ou NDJSON).
export async function* readLines(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      yield line
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0) yield buffer
}

// Extrai os payloads JSON das linhas "data: ..." de um stream SSE.
export async function* readSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<unknown> {
  for await (const line of readLines(body)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '' || data === '[DONE]') continue
    yield JSON.parse(data)
  }
}

export const trimSlash = (url: string): string => url.replace(/\/+$/, '')
