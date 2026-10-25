import { describe, expect, it } from 'vitest'
import type { Routine, RoutineRun } from '@shared/types'
import { getConversation, insertConversation, listConversations, listMessages } from '../src/main/db/repos/conversations'
import { getRoutine, insertRoutine, listRuns } from '../src/main/db/repos/routines'
import { buildHandoffText, handoff } from '../src/main/services/handoff'
import { Scheduler } from '../src/main/services/scheduler'
import { FakeClient, setup } from './helpers'

describe('chat', () => {
  it('grava pergunta e resposta, manda o histórico e o prompt do agente', async () => {
    const client = new FakeClient()
    const { db, chat, chunks, agent } = setup(client)
    const a = agent('Ana', 'modelo-a')
    const conv = insertConversation(db, a.id, 'manual')

    await chat.send(conv.id, 'primeira pergunta')
    const reply = await chat.send(conv.id, 'segunda')

    expect(reply.content).toBe('modelo-a recebeu: segunda')
    expect(listMessages(db, conv.id).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    const last = client.requests.at(-1)!
    expect(last.system).toBe('Você é Ana')
    expect(last.messages).toHaveLength(3)
    expect(getConversation(db, conv.id)!.title).toBe('primeira pergunta')
    // streaming em pedaços + aviso final
    const forConv = chunks.filter((c) => c.conversationId === conv.id)
    expect(forConv.filter((c) => !c.done).map((c) => c.delta).join('')).toContain('recebeu: segunda')
    expect(forConv.at(-1)).toMatchObject({ done: true })
  })

  it('em erro do modelo mantém a mensagem do usuário e libera a conversa', async () => {
    const { db, chat, chunks, agent } = setup(new FakeClient(() => Promise.reject(new Error('sem rede'))))
    const conv = insertConversation(db, agent('A').id, 'manual')
    await expect(chat.send(conv.id, 'oi')).rejects.toThrow('sem rede')
    expect(listMessages(db, conv.id).map((m) => m.role)).toEqual(['user'])
    expect(chat.isBusy(conv.id)).toBe(false)
    expect(chunks.at(-1)).toMatchObject({ conversationId: conv.id, done: true })
  })

  it('recusa duas mensagens ao mesmo tempo na mesma conversa', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { db, chat, agent } = setup(new FakeClient(async () => (await gate, 'ok')))
    const conv = insertConversation(db, agent('A').id, 'manual')
    const first = chat.send(conv.id, '1')
    await expect(chat.send(conv.id, '2')).rejects.toThrow('ainda está respondendo')
    release()
    await first
  })
})

describe('repasse', () => {
  it('abre conversa no destino com a resposta da origem', async () => {
    const { db, chat, agent } = setup()
    const a = agent('Pesquisador')
    const b = agent('Revisor')
    const result = await handoff(db, chat, {
      fromAgentId: a.id, toAgentId: b.id, content: 'texto bruto', instruction: 'Revise', origin: 'handoff'
    })
    const conv = getConversation(db, result.conversationId)!
    expect(conv).toMatchObject({ agentId: b.id, origin: 'handoff' })
    const [userMsg] = listMessages(db, conv.id)
    expect(userMsg).toMatchObject({ role: 'user', fromAgentId: a.id })
    expect(userMsg!.content).toBe(buildHandoffText('Revise', 'Pesquisador', 'texto bruto'))
    expect(result.reply.role).toBe('assistant')
  })

  it('não repassa para o próprio agente', async () => {
    const { db, chat, agent } = setup()
    const a = agent('A')
    await expect(
      handoff(db, chat, { fromAgentId: a.id, toAgentId: a.id, content: 'x', instruction: '', origin: 'handoff' })
    ).rejects.toThrow('diferente')
  })
})

describe('agendador', () => {
  function build(client = new FakeClient()) {
    const ctx = setup(client)
    const finished: [Routine, RoutineRun][] = []
    let changes = 0
    const scheduled: string[] = []
    const scheduler = new Scheduler({
      db: ctx.db,
      chat: ctx.chat,
      onRunsChanged: () => changes++,
      onRunFinished: (r, run) => finished.push([r, run]),
      // não agenda de verdade; só registra as expressões
      schedule: ((expr: string) => {
        scheduled.push(expr)
        return { destroy: () => undefined } as never
      }) as never
    })
    return { ...ctx, scheduler, finished, scheduled, changes: () => changes }
  }

  it('agenda só as rotinas ativas com cron válido', () => {
    const { db, agent, scheduler, scheduled } = build()
    const a = agent('A')
    const base = { sourceAgentId: a.id, taskPrompt: 't', targetAgentId: null, handoffPrompt: null }
    insertRoutine(db, { ...base, name: 'ativa', cron: '0 8 * * *', enabled: true })
    insertRoutine(db, { ...base, name: 'pausada', cron: '0 9 * * *', enabled: false })
    insertRoutine(db, { ...base, name: 'quebrada', cron: 'nunca', enabled: true })
    scheduler.start()
    expect(scheduled).toEqual(['0 8 * * *'])
    expect(scheduler.scheduledCount).toBe(1)
  })

  it('executa a origem, repassa ao destino e registra a execução', async () => {
    const { db, agent, scheduler, finished, changes } = build()
    const a = agent('Coletor', 'm-a')
    const b = agent('Resumidor', 'm-b')
    const r = insertRoutine(db, {
      name: 'Diário', cron: '0 8 * * *', sourceAgentId: a.id, taskPrompt: 'colete notícias',
      targetAgentId: b.id, handoffPrompt: 'resuma', enabled: true
    })

    const { run, done } = scheduler.trigger(r.id)
    expect(run.status).toBe('running')
    const result = await done

    expect(result.status).toBe('ok')
    expect(result.finishedAt).not.toBeNull()
    const src = listMessages(db, result.sourceConversationId!)
    expect(src.at(-1)!.content).toBe('m-a recebeu: colete notícias')
    const dst = listMessages(db, result.targetConversationId!)
    expect(dst[0]!.content).toContain('resuma')
    expect(dst[0]!.content).toContain('m-a recebeu: colete notícias')
    expect(dst.at(-1)!.role).toBe('assistant')
    expect(listConversations(db, b.id)[0]!.origin).toBe('routine')
    expect(getRoutine(db, r.id)!.lastRunAt).not.toBeNull()
    expect(finished).toHaveLength(1)
    expect(changes()).toBeGreaterThanOrEqual(3)
  })

  it('registra erro quando o modelo falha', async () => {
    const { db, agent, scheduler, finished } = build(new FakeClient(() => Promise.reject(new Error('cota excedida'))))
    const r = insertRoutine(db, {
      name: 'r', cron: '* * * * *', sourceAgentId: agent('A').id, taskPrompt: 't',
      targetAgentId: null, handoffPrompt: null, enabled: true
    })
    const result = await scheduler.trigger(r.id).done
    expect(result).toMatchObject({ status: 'error', error: 'cota excedida' })
    expect(listRuns(db, r.id)[0]!.status).toBe('error')
    expect(finished[0]![1].status).toBe('error')
  })
})
