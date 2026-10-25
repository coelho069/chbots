import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicClient } from '../src/main/llm/anthropic'
import { OllamaClient } from '../src/main/llm/ollama'
import { OpenAiCompatClient } from '../src/main/llm/openai-compat'
import { readSse } from '../src/main/llm/provider'
import { FileSecretStore } from '../src/main/secrets'

// Corpo de resposta que chega em pedaços arbitrários, como na rede.
function streamOf(text: string, pieceSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(i, i + pieceSize))
      i += pieceSize
    }
  })
}

function mockFetch(body: string, status = 200) {
  const fn = vi.fn(async () => new Response(streamOf(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const req = { model: 'm', system: 'sys', messages: [{ role: 'user' as const, content: 'oi' }], temperature: 0.3 }

describe('leitura de streaming', () => {
  it('junta linhas SSE quebradas entre pedaços e ignora [DONE]', async () => {
    const events: unknown[] = []
    for await (const e of readSse(streamOf('data: {"a":1}\r\n\ndata: {"b":"ç"}\n\ndata: [DONE]\n', 3))) events.push(e)
    expect(events).toEqual([{ a: 1 }, { b: 'ç' }])
  })
})

describe('adaptadores', () => {
  it('OpenAI-compatível: texto, uso de tokens e cabeçalho de autorização', async () => {
    const fetchMock = mockFetch(
      [
        'data: {"choices":[{"delta":{"content":"Olá"}}]}',
        'data: {"choices":[{"delta":{"content":" mundo"}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        'data: [DONE]',
        ''
      ].join('\n\n')
    )
    const deltas: string[] = []
    const result = await new OpenAiCompatClient('http://x/v1/', 'sk-1').chat(req, (d) => deltas.push(d))
    expect(result).toEqual({ text: 'Olá mundo', tokensIn: 5, tokensOut: 2 })
    expect(deltas).toEqual(['Olá', ' mundo'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://x/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1')
    expect(JSON.parse(init.body as string).messages[0]).toEqual({ role: 'system', content: 'sys' })
  })

  it('Anthropic: eventos de conteúdo e uso', async () => {
    const fetchMock = mockFetch(
      [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":9}}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Oi"}}',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":1}}',
        ''
      ].join('\n\n')
    )
    const result = await new AnthropicClient('https://api.anthropic.com', 'k').chat(req, () => undefined)
    expect(result).toEqual({ text: 'Oi', tokensIn: 9, tokensOut: 1 })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ system: 'sys', max_tokens: 8192, stream: true })
  })

  it('Anthropic sem chave falha antes de chamar a rede', async () => {
    const fetchMock = mockFetch('')
    await expect(new AnthropicClient('https://api.anthropic.com', null).chat(req, () => undefined)).rejects.toThrow(
      'sem chave'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Ollama: NDJSON', async () => {
    mockFetch(
      '{"message":{"content":"a"},"done":false}\n{"message":{"content":"b"},"done":true,"prompt_eval_count":3,"eval_count":2}\n'
    )
    const result = await new OllamaClient('http://127.0.0.1:11434').chat(req, () => undefined)
    expect(result).toEqual({ text: 'ab', tokensIn: 3, tokensOut: 2 })
  })

  it('erro HTTP vira mensagem legível', async () => {
    mockFetch('{"error":"invalid key"}', 401)
    await expect(new OpenAiCompatClient('http://x', 'bad').chat(req, () => undefined)).rejects.toThrow(
      'API respondeu 401: {"error":"invalid key"}'
    )
  })
})

describe('cofre de chaves', () => {
  it('guarda cifrado em arquivo e relê', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilotos-'))
    const file = join(dir, 'secrets.json')
    const cipher = {
      encrypt: (s: string) => Buffer.from([...s].reverse().join('')),
      decrypt: (b: Buffer) => [...b.toString()].reverse().join('')
    }
    const store = new FileSecretStore(file, cipher)
    store.set('provider:1', 'sk-segredo')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-segredo')
    expect(new FileSecretStore(file, cipher).get('provider:1')).toBe('sk-segredo')
    store.delete('provider:1')
    expect(new FileSecretStore(file, cipher).get('provider:1')).toBeNull()
  })
})
