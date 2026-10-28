import { describe, it, expect, vi } from 'vitest'
import { buildApi } from '../../src/shared/apiFactory'

function makeInvoke() {
  return vi.fn((_channel: string, ..._args: unknown[]) => Promise.resolve(null))
}
function makeSubscribe() {
  return vi.fn((_channel: string, _listener: unknown) => () => {})
}

describe('apiFactory — mesmos métodos no Electron e na web', () => {
  it('buildApi retorna todos os grupos de API', () => {
    const api = buildApi(makeInvoke(), makeSubscribe())
    const groups = [
      'providers', 'agents', 'conversations', 'chat', 'routines',
      'settings', 'access', 'update', 'app', 'prompts', 'blackbox',
      'memory', 'delegation', 'perf', 'flows', 'mcp', 'office',
      'pages', 'drafts', 'verificacoes'
    ]
    for (const g of groups) {
      expect(api).toHaveProperty(g, expect.any(Object))
    }
  })

  it('providers tem list, create, update, remove, listModels', () => {
    const api = buildApi(makeInvoke(), makeSubscribe())
    expect(typeof api.providers.list).toBe('function')
    expect(typeof api.providers.create).toBe('function')
    expect(typeof api.providers.update).toBe('function')
    expect(typeof api.providers.remove).toBe('function')
    expect(typeof api.providers.listModels).toBe('function')
  })

  it('agents tem list, create, update, duplicate, remove', () => {
    const api = buildApi(makeInvoke(), makeSubscribe())
    expect(typeof api.agents.list).toBe('function')
    expect(typeof api.agents.create).toBe('function')
    expect(typeof api.agents.update).toBe('function')
    expect(typeof api.agents.duplicate).toBe('function')
    expect(typeof api.agents.remove).toBe('function')
  })

  it('chat tem send, stop, handoff, onChunk', () => {
    const api = buildApi(makeInvoke(), makeSubscribe())
    expect(typeof api.chat.send).toBe('function')
    expect(typeof api.chat.stop).toBe('function')
    expect(typeof api.chat.handoff).toBe('function')
    expect(typeof api.chat.onChunk).toBe('function')
  })

  it('update tem version, check, apply, status, last, ack, onProgress', () => {
    const api = buildApi(makeInvoke(), makeSubscribe())
    expect(typeof api.update.version).toBe('function')
    expect(typeof api.update.check).toBe('function')
    expect(typeof api.update.apply).toBe('function')
    expect(typeof api.update.status).toBe('function')
    expect(typeof api.update.last).toBe('function')
    expect(typeof api.update.ack).toBe('function')
    expect(typeof api.update.onProgress).toBe('function')
  })

  it('buildApi chamado duas vezes produz APIs com mesma forma', () => {
    const api1 = buildApi(makeInvoke(), makeSubscribe())
    const api2 = buildApi(makeInvoke(), makeSubscribe())
    expect(Object.keys(api1).sort()).toEqual(Object.keys(api2).sort())
    for (const group of Object.keys(api1) as Array<keyof typeof api1>) {
      expect(Object.keys(api1[group]).sort()).toEqual(Object.keys(api2[group]).sort())
    }
  })

  it('invoke é chamado com o canal correto para agents.list', async () => {
    const invoke = makeInvoke()
    const api = buildApi(invoke, makeSubscribe())
    await api.agents.list()
    expect(invoke).toHaveBeenCalledOnce()
    // O canal deve ser uma string não vazia
    const [channel] = invoke.mock.calls[0]
    expect(typeof channel).toBe('string')
    expect((channel as string).length).toBeGreaterThan(0)
  })
})
