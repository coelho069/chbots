import { describe, expect, it, vi } from 'vitest'
import { extractDelegations, extractManualDelegation } from '../src/main/services/delegation'

// Testes de parsing — sem dependências de Electron/DB
describe('extractDelegations', () => {
  it('extrai bloco simples', () => {
    const text = 'Vou delegar: {"delegar": {"para": "BotB", "tarefa": "calcule isso"}}'
    expect(extractDelegations(text)).toEqual([{ para: 'BotB', tarefa: 'calcule isso' }])
  })

  it('extrai múltiplos blocos', () => {
    const text = '{"delegar": {"para": "A", "tarefa": "x"}} e {"delegar": {"para": "B", "tarefa": "y"}}'
    const result = extractDelegations(text)
    expect(result).toHaveLength(2)
    expect(result[0]!.para).toBe('A')
    expect(result[1]!.para).toBe('B')
  })

  it('não extrai JSON inválido', () => {
    expect(extractDelegations('{"delegar": "invalido"}')).toHaveLength(0)
  })
})

describe('extractManualDelegation', () => {
  it('extrai @NomeBot tarefa', () => {
    expect(extractManualDelegation('@BotX faça um resumo')).toEqual({ para: 'BotX', tarefa: 'faça um resumo' })
  })

  it('retorna null para texto sem @', () => {
    expect(extractManualDelegation('olá mundo')).toBeNull()
  })

  it('permite tarefa com múltiplas linhas', () => {
    const result = extractManualDelegation('@Bot analise\nesta tarefa')
    expect(result?.tarefa).toBe('analise\nesta tarefa')
  })
})

// Testes de lógica de bloqueio usando stubs mínimos
describe('DelegationService bloqueios', async () => {
  const { DelegationService } = await import('../src/main/services/delegation')
  const { DatabaseSync } = await import('node:sqlite')

  function makeDb() {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, color TEXT, system_prompt TEXT,
        provider_id INTEGER, model TEXT, temperature REAL, created_at TEXT, updated_at TEXT);
      CREATE TABLE conversations (id INTEGER PRIMARY KEY, agent_id INTEGER, title TEXT,
        origin TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id INTEGER, role TEXT,
        content TEXT, from_agent_id INTEGER, tokens_in INTEGER, tokens_out INTEGER, created_at TEXT);
      CREATE TABLE agent_delegation_config (
        agent_id INTEGER PRIMARY KEY, pode_delegar INTEGER DEFAULT 0, pode_receber INTEGER DEFAULT 1,
        destinos_json TEXT DEFAULT '[]', max_profundidade INTEGER DEFAULT 2, max_por_resposta INTEGER DEFAULT 3
      );
      CREATE TABLE delegacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, conversa_id INTEGER, bot_origem_id INTEGER,
        bot_destino_id INTEGER, tarefa TEXT, resposta TEXT, status TEXT, profundidade INTEGER,
        iniciado_em TEXT, finalizado_em TEXT, erro TEXT
      );
    `)
    db.prepare("INSERT INTO agents VALUES (1,'A','#fff','',1,'m',0.7,'t','t')").run()
    db.prepare("INSERT INTO agents VALUES (2,'B','#fff','',1,'m',0.7,'t','t')").run()
    db.prepare("INSERT INTO agents VALUES (3,'C','#fff','',1,'m',0.7,'t','t')").run()
    db.prepare("INSERT INTO conversations VALUES (1,1,'test','manual','t','t')").run()
    return db
  }

  it('bloqueia delegação para si mesmo', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO agent_delegation_config VALUES (1,1,1,'[1]',2,3)").run()
    const svc = new DelegationService({ db: db as never, chat: {} as never, onCard: vi.fn() })
    await expect(svc.delegate({ conversaId: 1, botOrigemId: 1, botDestinoId: 1, tarefa: 'x', depth: 0, callStack: [1] })).rejects.toThrow('si mesmo')
  })

  it('bloqueia ciclo A→B→A', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO agent_delegation_config VALUES (1,1,1,'[2]',2,3)").run()
    const svc = new DelegationService({ db: db as never, chat: {} as never, onCard: vi.fn() })
    await expect(svc.delegate({ conversaId: 1, botOrigemId: 1, botDestinoId: 2, tarefa: 'x', depth: 1, callStack: [1, 2] })).rejects.toThrow('Ciclo')
  })

  it('bloqueia profundidade acima do limite', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO agent_delegation_config VALUES (1,1,1,'[2]',1,3)").run()
    const svc = new DelegationService({ db: db as never, chat: {} as never, onCard: vi.fn() })
    await expect(svc.delegate({ conversaId: 1, botOrigemId: 1, botDestinoId: 2, tarefa: 'x', depth: 2, callStack: [1] })).rejects.toThrow('Profundidade')
  })

  it('bloqueia destino não permitido', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO agent_delegation_config VALUES (1,1,1,'[3]',2,3)").run()
    const svc = new DelegationService({ db: db as never, chat: {} as never, onCard: vi.fn() })
    await expect(svc.delegate({ conversaId: 1, botOrigemId: 1, botDestinoId: 2, tarefa: 'x', depth: 0, callStack: [1] })).rejects.toThrow('lista de destinos')
  })

  it('erro do bot destino não vaza sem mensagem', async () => {
    const db = makeDb()
    db.prepare("INSERT INTO agent_delegation_config VALUES (1,1,1,'[2]',2,3)").run()
    db.prepare("INSERT INTO agent_delegation_config VALUES (2,1,1,'[]',2,3)").run()
    const chat = { send: vi.fn().mockRejectedValue(new Error('timeout')) }
    const svc = new DelegationService({ db: db as never, chat: chat as never, onCard: vi.fn() })
    await expect(svc.delegate({ conversaId: 1, botOrigemId: 1, botDestinoId: 2, tarefa: 'x', depth: 0, callStack: [1] })).rejects.toThrow('timeout')
    // delegação no DB deve estar com status error
    const row = db.prepare('SELECT status FROM delegacoes WHERE id=1').get() as { status: string }
    expect(row.status).toBe('error')
  })
})
