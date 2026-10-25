import type { ChatChunk } from '@shared/types'
import { openDatabase, type Db } from '../src/main/db/connection'
import { insertAgent } from '../src/main/db/repos/agents'
import { insertProvider } from '../src/main/db/repos/providers'
import type { ChatRequest, ChatResult, LlmClient } from '../src/main/llm/provider'
import { MemorySecretStore } from '../src/main/secrets'
import { ChatService } from '../src/main/services/chat'

// Cliente falso: responde com uma função do pedido e emite a resposta em dois pedaços.
export class FakeClient implements LlmClient {
  requests: ChatRequest[] = []
  constructor(private readonly reply: (req: ChatRequest) => string | Promise<string> = defaultReply) {}

  async chat(req: ChatRequest, onDelta: (d: string) => void): Promise<ChatResult> {
    this.requests.push(req)
    const text = await this.reply(req)
    const half = Math.ceil(text.length / 2)
    onDelta(text.slice(0, half))
    onDelta(text.slice(half))
    return { text, tokensIn: 10, tokensOut: text.length }
  }

  async listModels(): Promise<string[]> {
    return ['fake-1']
  }
}

const defaultReply = (req: ChatRequest): string => `${req.model} recebeu: ${req.messages.at(-1)!.content}`

export function setup(client: LlmClient = new FakeClient()) {
  const db: Db = openDatabase(':memory:')
  const chunks: ChatChunk[] = []
  const chat = new ChatService({
    db,
    secrets: new MemorySecretStore(),
    createClient: () => client,
    onChunk: (c) => chunks.push(c)
  })
  const provider = insertProvider(db, { kind: 'openai', name: 'Fake', baseUrl: 'http://localhost' })
  const agent = (name: string, model = name.toLowerCase()) =>
    insertAgent(db, { name, color: '#123456', systemPrompt: `Você é ${name}`, providerId: provider.id, model, temperature: 0.5, usarCache: false })
  return { db, chat, chunks, provider, agent }
}
