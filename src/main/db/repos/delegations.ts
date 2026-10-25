import type { DelegationConfig, DelegationEntry } from '@shared/types'
import type { Db } from '../connection'

type RawConfig = { agent_id: number; pode_delegar: number; pode_receber: number; destinos_json: string; max_profundidade: number; max_por_resposta: number }
type RawEntry = { id: number; conversa_id: number; bot_origem_id: number; bot_destino_id: number; tarefa: string; resposta: string | null; status: string; profundidade: number; iniciado_em: string; finalizado_em: string | null; erro: string | null }

const toConfig = (r: RawConfig): DelegationConfig => ({
  agentId: r.agent_id,
  podeDelegar: r.pode_delegar === 1,
  podeReceber: r.pode_receber === 1,
  destinosPermitidos: JSON.parse(r.destinos_json) as number[],
  maxProfundidade: r.max_profundidade,
  maxPorResposta: r.max_por_resposta
})

const toEntry = (r: RawEntry): DelegationEntry => ({
  id: r.id,
  conversaId: r.conversa_id,
  botOrigemId: r.bot_origem_id,
  botDestinoId: r.bot_destino_id,
  tarefa: r.tarefa,
  resposta: r.resposta,
  status: r.status as DelegationEntry['status'],
  profundidade: r.profundidade,
  iniciadoEm: r.iniciado_em,
  finalizadoEm: r.finalizado_em,
  erro: r.erro
})

export function getDelegationConfig(db: Db, agentId: number): DelegationConfig {
  const row = db.prepare('SELECT * FROM agent_delegation_config WHERE agent_id = ?').get(agentId) as RawConfig | undefined
  return row ? toConfig(row) : { agentId, podeDelegar: false, podeReceber: true, destinosPermitidos: [], maxProfundidade: 2, maxPorResposta: 3 }
}

export function saveDelegationConfig(db: Db, cfg: DelegationConfig): void {
  db.prepare(`
    INSERT INTO agent_delegation_config(agent_id, pode_delegar, pode_receber, destinos_json, max_profundidade, max_por_resposta)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      pode_delegar = excluded.pode_delegar,
      pode_receber = excluded.pode_receber,
      destinos_json = excluded.destinos_json,
      max_profundidade = excluded.max_profundidade,
      max_por_resposta = excluded.max_por_resposta
  `).run(cfg.agentId, cfg.podeDelegar ? 1 : 0, cfg.podeReceber ? 1 : 0, JSON.stringify(cfg.destinosPermitidos), cfg.maxProfundidade, cfg.maxPorResposta)
}

export function insertDelegation(db: Db, data: { conversaId: number; botOrigemId: number; botDestinoId: number; tarefa: string; profundidade: number }): DelegationEntry {
  const now = new Date().toISOString()
  const res = db.prepare(`
    INSERT INTO delegacoes(conversa_id, bot_origem_id, bot_destino_id, tarefa, status, profundidade, iniciado_em)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(data.conversaId, data.botOrigemId, data.botDestinoId, data.tarefa, data.profundidade, now)
  return getDelegation(db, Number(res.lastInsertRowid))!
}

export function finishDelegation(db: Db, id: number, result: { resposta?: string | null; erro?: string | null }): void {
  const status = result.erro ? 'error' : 'ok'
  db.prepare(`
    UPDATE delegacoes SET status=?, resposta=?, erro=?, finalizado_em=? WHERE id=?
  `).run(status, result.resposta ?? null, result.erro ?? null, new Date().toISOString(), id)
}

export function getDelegation(db: Db, id: number): DelegationEntry | undefined {
  const row = db.prepare('SELECT * FROM delegacoes WHERE id=?').get(id) as RawEntry | undefined
  return row ? toEntry(row) : undefined
}

export function listDelegations(db: Db, conversaId: number): DelegationEntry[] {
  return (db.prepare('SELECT * FROM delegacoes WHERE conversa_id=? ORDER BY iniciado_em ASC').all(conversaId) as unknown as RawEntry[]).map(toEntry)
}
