import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { migrations } from '../src/main/db/migrations'
import { deleteAgent, getAgent, listAgents, updateAgent } from '../src/main/db/repos/agents'
import { insertConversation, insertMessage, listConversations, listMessages } from '../src/main/db/repos/conversations'
import { providerInUse, toPublic, getProvider, setProviderKeyRef } from '../src/main/db/repos/providers'
import { failStaleRuns, getRoutine, insertRoutine, listRuns, startRun } from '../src/main/db/repos/routines'
import { getSettings, saveSettings } from '../src/main/db/repos/settings'
import { setup } from './helpers'

describe('banco', () => {
  it('aplica as migrações e registra a versão', () => {
    const db = openDatabase(':memory:')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(migrations.length)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (t) => t.name
    )
    expect(tables).toEqual(
      expect.arrayContaining(['providers', 'agents', 'conversations', 'messages', 'routines', 'routine_runs', 'settings'])
    )
  })

  it('cria, edita e lista agentes', () => {
    const { db, agent, provider } = setup()
    const a = agent('Zeta')
    agent('alfa')
    expect(listAgents(db).map((x) => x.name)).toEqual(['alfa', 'Zeta'])
    const edited = updateAgent(db, a.id, { ...a, name: 'Zeta 2', temperature: 1.2 })
    expect(edited).toMatchObject({ name: 'Zeta 2', temperature: 1.2, providerId: provider.id })
  })

  it('apagar agente apaga conversas e mensagens, e rotinas de origem', () => {
    const { db, agent } = setup()
    const a = agent('A')
    const b = agent('B')
    const conv = insertConversation(db, a.id, 'manual')
    insertMessage(db, { conversationId: conv.id, role: 'user', content: 'oi' })
    const asSource = insertRoutine(db, {
      name: 'r1', cron: '* * * * *', sourceAgentId: a.id, taskPrompt: 't',
      targetAgentId: null, handoffPrompt: null, enabled: true
    })
    const asTarget = insertRoutine(db, {
      name: 'r2', cron: '* * * * *', sourceAgentId: b.id, taskPrompt: 't',
      targetAgentId: a.id, handoffPrompt: 'x', enabled: true
    })

    deleteAgent(db, a.id)

    expect(getAgent(db, a.id)).toBeNull()
    expect(listConversations(db, a.id)).toEqual([])
    expect(listMessages(db, conv.id)).toEqual([])
    expect(getRoutine(db, asSource.id)).toBeNull()
    expect(getRoutine(db, asTarget.id)?.targetAgentId).toBeNull()
  })

  it('não expõe key_ref e sabe quando o provedor está em uso', () => {
    const { db, provider, agent } = setup()
    setProviderKeyRef(db, provider.id, 'provider:1')
    const pub = toPublic(getProvider(db, provider.id)!)
    expect(pub).not.toHaveProperty('keyRef')
    expect(pub.hasKey).toBe(true)
    expect(providerInUse(db, provider.id)).toBe(false)
    agent('A')
    expect(providerInUse(db, provider.id)).toBe(true)
  })

  it('marca execuções interrompidas como erro', () => {
    const { db, agent } = setup()
    const a = agent('A')
    const r = insertRoutine(db, {
      name: 'r', cron: '* * * * *', sourceAgentId: a.id, taskPrompt: 't',
      targetAgentId: null, handoffPrompt: null, enabled: true
    })
    startRun(db, r.id)
    failStaleRuns(db)
    const [run] = listRuns(db, r.id)
    expect(run).toMatchObject({ status: 'error', error: 'Interrompida (app fechado)' })
    expect(run!.finishedAt).not.toBeNull()
  })

  it('salva configurações e ignora chaves desconhecidas', () => {
    const { db } = setup()
    expect(getSettings(db)).toEqual({ minimizeToTray: true, notifyOnRun: true, retentionDays: 30 })
    db.prepare("INSERT INTO settings (key, value) VALUES ('lixo', '1')").run()
    expect(saveSettings(db, { minimizeToTray: false, notifyOnRun: true, retentionDays: 30 })).toEqual({
      minimizeToTray: false,
      notifyOnRun: true,
      retentionDays: 30
    })
  })
})
