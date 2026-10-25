import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultNodeData, validateGraph, type FlowGraph, type FlowNode } from '../src/shared/flows'
import { flowGraphInput, promptGenerateInput } from '../src/shared/schemas'
import { MIN_PROMPT_CHARS } from '../src/shared/types'
import { openDatabase } from '../src/main/db/connection'
import { deleteAgent } from '../src/main/db/repos/agents'
import { getFlowGraph, insertFlow } from '../src/main/db/repos/flows'
import { migrations } from '../src/main/db/migrations'
import {
  countChars,
  deleteGeneratedPrompt,
  insertGeneratedPrompt,
  listGeneratedPrompts
} from '../src/main/db/repos/prompts'
import { createEngineActions } from '../src/main/flows/actions'
import { executeFlow } from '../src/main/flows/engine'
import type { ChatRequest, ChatResult, LlmClient } from '../src/main/llm/provider'
import {
  cleanReply,
  correctionSystem,
  generationSystem,
  promptSections,
  PromptGenerator
} from '../src/main/services/promptGen'
import { FakeClient, setup } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

const long = (tag: string) => `${tag} ${'x'.repeat(MIN_PROMPT_CHARS)}`
const short = (tag: string) => `${tag} curto`

// Modelo falso: na correção devolve o texto marcado; na geração, responde a sequência dada (uma por chamada).
function scripted(generation: string[], correction = (idea: string) => `CORRIGIDO: ${idea}`) {
  const queue = [...generation]
  return new FakeClient((req) => {
    if (req.system === correctionSystem) {
      const idea = req.messages[0]!.content.replace(/^<<<\n/, '').replace(/\n>>>$/, '')
      return correction(idea)
    }
    const next = queue.shift()
    if (next === undefined) throw new Error('chamada inesperada ao modelo')
    return next
  })
}

function world(client: LlmClient, timeoutSec?: number) {
  const s = setup(client)
  const agent = s.agent('Gerador', 'modelo-x')
  const gen = new PromptGenerator({ db: s.db, clientFor: (id) => s.chat.clientFor(id), timeoutSec })
  return { ...s, agentRow: agent, gen }
}

describe('Gerador de Prompts: correção', () => {
  it('usa o modelo e a temperatura do agente, mas instruções próprias (não o prompt de sistema dele)', async () => {
    const client = scripted([])
    const { gen, agentRow } = world(client)
    const fixed = await gen.correct(agentRow.id, '  quero um asistente de cardapio  ')
    expect(fixed).toBe('CORRIGIDO: quero um asistente de cardapio')
    const req = client.requests[0]!
    expect(req).toMatchObject({ model: 'modelo-x', temperature: 0.5, system: correctionSystem })
    expect(req.system).not.toContain('Você é Gerador')
    expect(req.messages).toEqual([{ role: 'user', content: '<<<\nquero um asistente de cardapio\n>>>' }])
  })

  it('limpa bloco de código e marcadores que o modelo puser em volta', async () => {
    const { gen, agentRow } = world(scripted([], () => '```text\n<<<\nTexto corrigido.\n>>>\n```'))
    expect(await gen.correct(agentRow.id, 'texto')).toBe('Texto corrigido.')
  })

  it('não cria conversas no Chat', async () => {
    const { gen, agentRow, db } = world(scripted([]))
    await gen.correct(agentRow.id, 'ideia')
    expect(db.prepare('SELECT COUNT(*) AS c FROM conversations').get()).toEqual({ c: 0 })
  })
})

describe('Gerador de Prompts: geração e expansão', () => {
  it('pede as 11 seções e o mínimo de caracteres', () => {
    expect(promptSections).toHaveLength(11)
    for (const [i, s] of promptSections.entries()) expect(generationSystem).toContain(`## ${i + 1}. ${s}`)
    expect(generationSystem).toContain(`NO MÍNIMO ${MIN_PROMPT_CHARS} caracteres`)
  })

  it('prompt longo de primeira: uma chamada, sem expansão, salvo no histórico', async () => {
    const client = scripted([long('P1')])
    const { gen, agentRow, db } = world(client)
    const r = await gen.generate({ agentId: agentRow.id, originalIdea: ' ideia crua ', correctedIdea: ' Ideia corrigida. ' })
    expect(r.expansions).toBe(0)
    expect(client.requests).toHaveLength(1)
    expect(client.requests[0]!.messages).toEqual([{ role: 'user', content: 'Ideia:\nIdeia corrigida.' }])
    expect(r.record).toMatchObject({
      originalIdea: 'ideia crua',
      correctedIdea: 'Ideia corrigida.',
      prompt: long('P1'),
      chars: countChars(long('P1')),
      agentId: agentRow.id
    })
    expect(listGeneratedPrompts(db)).toEqual([r.record])
  })

  it('curto na primeira: pede para expandir mostrando a contagem e fica com a versão longa', async () => {
    const client = scripted([short('P1'), long('P2')])
    const { gen, agentRow } = world(client)
    const r = await gen.generate({ agentId: agentRow.id, originalIdea: 'i', correctedIdea: 'I.' })
    expect(r.expansions).toBe(1)
    expect(r.record.prompt).toBe(long('P2'))
    const second = client.requests[1]!.messages
    expect(second).toHaveLength(3)
    expect(second[1]).toEqual({ role: 'assistant', content: short('P1') })
    expect(second[2]!.content).toContain(`tem ${countChars(short('P1'))} caracteres; o mínimo é ${MIN_PROMPT_CHARS}`)
  })

  it('para depois de 2 expansões e guarda a versão mais longa, mesmo abaixo do mínimo', async () => {
    const client = scripted(['a', 'versão mais longa de todas', 'média'])
    const { gen, agentRow } = world(client)
    const r = await gen.generate({ agentId: agentRow.id, originalIdea: 'i', correctedIdea: 'I.' })
    expect(client.requests).toHaveLength(3)
    expect(r.expansions).toBe(2)
    expect(r.record.prompt).toBe('versão mais longa de todas')
    expect(r.record.chars).toBeLessThan(MIN_PROMPT_CHARS)
  })

  it('conta acentos e emoji como 1 caractere', () => {
    expect(countChars('ação')).toBe(4)
    expect(countChars('ok 👍')).toBe(4)
  })

  it('run() faz correção + geração e grava as duas versões da ideia', async () => {
    const { gen, agentRow } = world(scripted([long('P')]))
    const r = await gen.run(agentRow.id, 'ideia com eros')
    expect(r.record).toMatchObject({ originalIdea: 'ideia com eros', correctedIdea: 'CORRIGIDO: ideia com eros' })
  })
})

describe('Gerador de Prompts: erros', () => {
  it('tempo limite de 60 s por chamada, com etapa na mensagem, e cancela a chamada', async () => {
    vi.useFakeTimers()
    let aborted = false
    const hanging: LlmClient = {
      chat: (req: ChatRequest) =>
        new Promise<ChatResult>(() => {
          req.signal?.addEventListener('abort', () => (aborted = true))
        }),
      listModels: async () => []
    }
    const { gen, agentRow } = world(hanging)
    const pending = gen.correct(agentRow.id, 'ideia')
    const check = expect(pending).rejects.toThrow('O modelo não respondeu em 60 s (etapa: correção)')
    await vi.advanceTimersByTimeAsync(60_000)
    await check
    expect(aborted).toBe(true)
  })

  it('erro do modelo vira mensagem clara e nada é salvo', async () => {
    const failing = new FakeClient(() => {
      throw new Error('OpenAI respondeu 401: chave inválida')
    })
    const { gen, agentRow, db } = world(failing)
    await expect(gen.generate({ agentId: agentRow.id, originalIdea: 'i', correctedIdea: 'I.' })).rejects.toThrow(
      'Falha na geração com o modelo modelo-x: OpenAI respondeu 401: chave inválida'
    )
    expect(listGeneratedPrompts(db)).toEqual([])
  })

  it('resposta vazia é erro', async () => {
    const { gen, agentRow } = world(scripted([], () => '   '))
    await expect(gen.correct(agentRow.id, 'x')).rejects.toThrow('O modelo devolveu uma resposta vazia (etapa: correção).')
  })

  it('agente excluído é erro', async () => {
    const { gen, agentRow, db } = world(scripted([]))
    deleteAgent(db, agentRow.id)
    await expect(gen.correct(agentRow.id, 'x')).rejects.toThrow('O agente escolhido não existe mais')
  })

  it('valida a entrada do IPC: ideia vazia é recusada', () => {
    expect(promptGenerateInput.safeParse({ agentId: 1, originalIdea: '  ', correctedIdea: 'x' }).success).toBe(false)
    expect(promptGenerateInput.safeParse({ agentId: 1, originalIdea: 'a', correctedIdea: 'b' }).success).toBe(true)
  })

  it('cleanReply mantém texto que só contém aspas no meio', () => {
    expect(cleanReply('"Ele disse "oi" e saiu"')).toBe('"Ele disse "oi" e saiu"')
    expect(cleanReply('"Frase entre aspas."')).toBe('Frase entre aspas.')
  })
})

describe('Gerador de Prompts: histórico', () => {
  it('lista os 20 mais recentes, apaga e sobrevive à exclusão do agente', () => {
    const { db, agent } = setup()
    const a = agent('A')
    for (let i = 1; i <= 25; i++) insertGeneratedPrompt(db, { originalIdea: `o${i}`, correctedIdea: `c${i}`, prompt: `p${i}`, agentId: a.id })
    const list = listGeneratedPrompts(db)
    expect(list).toHaveLength(20)
    expect(list[0]!.originalIdea).toBe('o25')
    expect(list[19]!.originalIdea).toBe('o6')

    deleteGeneratedPrompt(db, list[0]!.id)
    expect(listGeneratedPrompts(db)[0]!.originalIdea).toBe('o24')

    deleteAgent(db, a.id)
    expect(listGeneratedPrompts(db)[0]!.agentId).toBeNull()
  })

  it('migra um banco da versão 3 sem perder fluxos e cria a tabela prompts_gerados', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pilotos-pg-')), 'v3.db')
    const old = new DatabaseSync(file)
    old.exec('PRAGMA foreign_keys = ON')
    for (const m of migrations.slice(0, 3)) old.exec(m)
    old.exec('PRAGMA user_version = 3')
    old.exec(`INSERT INTO flows (id, name, created_at, updated_at) VALUES (1, 'F', 'x', 'x')`)
    old.exec(`INSERT INTO flow_nodes VALUES ('t', 1, 'trigger', '{}', 0, 0), ('n', 1, 'news', '{}', 1, 1)`)
    old.exec(`INSERT INTO flow_edges VALUES ('e', 1, 't', 'n', NULL)`)
    old.close()

    const db = openDatabase(file)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: migrations.length })
    expect(db.prepare('SELECT id FROM flow_edges').all()).toEqual([{ id: 'e' }])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'prompts_gerados'").get()).toEqual({ name: 'prompts_gerados' })
    db.close()
  })
})

// ---- Nó de Fluxo ----

const n = (id: string, type: FlowNode['type'], data: object = {}): FlowNode =>
  ({ id, type, data: { ...defaultNodeData(type), ...data }, position: { x: 0, y: 0 } }) as FlowNode

describe('Gerador de Prompt no Fluxo', () => {
  it('entrada = ideia, saída = prompt; também grava no histórico', async () => {
    const client = scripted([long('PROMPT')])
    const { db, chat, gen, agentRow } = world(client)
    const graph: FlowGraph = {
      nodes: [n('t', 'trigger', { input: 'ideia do fluxo' }), n('pg', 'promptgen', { agentId: agentRow.id }), n('o', 'output', { action: 'notify' })],
      edges: [
        { id: 'e1', source: 't', target: 'pg', conditionValue: null },
        { id: 'e2', source: 'pg', target: 'o', conditionValue: null }
      ]
    }
    expect(validateGraph(graph)).toEqual([])
    expect(flowGraphInput.safeParse(graph).success).toBe(true)
    // o banco aceita o tipo novo
    insertFlow(db, { name: 'F', description: '' }, graph)

    const notified: string[] = []
    const actions = createEngineActions({ db, chat, promptGen: gen, defaultFolder: tmpdir(), notify: (_t, body) => notified.push(body) })('F')
    const r = await executeFlow(graph, { flowName: 'F', actions })
    expect(r.status).toBe('ok')
    expect(r.outputs.pg).toBe(long('PROMPT'))
    expect(listGeneratedPrompts(db)[0]).toMatchObject({ originalIdea: 'ideia do fluxo', correctedIdea: 'CORRIGIDO: ideia do fluxo' })
    expect(getFlowGraph(db, 1).nodes.map((x) => x.type)).toContain('promptgen')
  })

  it('sem ideia na entrada é erro claro', async () => {
    const { db, chat, gen, agentRow } = world(scripted([]))
    const graph: FlowGraph = {
      nodes: [n('t', 'trigger'), n('pg', 'promptgen', { agentId: agentRow.id })],
      edges: [{ id: 'e1', source: 't', target: 'pg', conditionValue: null }]
    }
    const actions = createEngineActions({ db, chat, promptGen: gen, defaultFolder: tmpdir(), notify: () => undefined })('F')
    const r = await executeFlow(graph, { flowName: 'F', actions })
    expect(r).toMatchObject({ status: 'error', error: expect.stringContaining('sem ideia') })
  })

  it('exige agente e tem tempo limite padrão de 300 s', () => {
    expect(defaultNodeData('promptgen')).toEqual({ agentId: null, timeoutSec: 300 })
    const graph: FlowGraph = {
      nodes: [n('t', 'trigger'), n('pg', 'promptgen')],
      edges: [{ id: 'e1', source: 't', target: 'pg', conditionValue: null }]
    }
    expect(validateGraph(graph)).toEqual(['Gerador de Prompt: escolha um agente.'])
  })
})
