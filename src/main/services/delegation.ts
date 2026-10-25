import type { DelegationCard } from '@shared/types'
import { getAgent, listAgents } from '../db/repos/agents'
import { insertConversation } from '../db/repos/conversations'
import { finishDelegation, getDelegationConfig, getDelegation, insertDelegation } from '../db/repos/delegations'
import type { Db } from '../db/connection'
import type { ChatService } from './chat'

export interface DelegationDeps {
  db: Db
  chat: ChatService
  onCard: (card: DelegationCard) => void
}

export class DelegationService {
  constructor(private readonly deps: DelegationDeps) {}

  // Resolve "NomeDoBot" → agentId (case-insensitive)
  resolveByName(name: string): number | undefined {
    const agents = listAgents(this.deps.db)
    return agents.find((a) => a.name.toLowerCase() === name.toLowerCase())?.id
  }

  async delegate(opts: {
    conversaId: number
    botOrigemId: number
    botDestinoId: number
    tarefa: string
    depth: number
    callStack: number[]  // IDs dos agentes já na cadeia, para detectar ciclos
  }): Promise<string> {
    const { db, chat, onCard } = this.deps
    const { conversaId, botOrigemId, botDestinoId, tarefa, depth, callStack } = opts

    // Validações de segurança
    const cfgOrigem = getDelegationConfig(db, botOrigemId)
    if (!cfgOrigem.podeDelegar) throw new Error(`Agente de origem não tem permissão para delegar`)
    if (!cfgOrigem.destinosPermitidos.includes(botDestinoId)) throw new Error(`Agente de destino não está na lista de destinos permitidos`)
    if (depth > cfgOrigem.maxProfundidade) throw new Error(`Profundidade máxima de delegação (${cfgOrigem.maxProfundidade}) atingida`)
    if (botDestinoId === botOrigemId) throw new Error(`Um agente não pode delegar para si mesmo`)
    if (callStack.includes(botDestinoId)) throw new Error(`Ciclo de delegação detectado: ${callStack.join('→')}→${botDestinoId}`)

    const cfgDestino = getDelegationConfig(db, botDestinoId)
    if (!cfgDestino.podeReceber) throw new Error(`Agente de destino não aceita tarefas delegadas`)

    const destAgent = getAgent(db, botDestinoId)
    if (!destAgent) throw new Error('Agente de destino não encontrado')

    const entry = insertDelegation(db, { conversaId, botOrigemId, botDestinoId, tarefa, profundidade: depth })

    onCard({
      id: entry.id, conversaId, botDestinoNome: destAgent.name,
      tarefa, resposta: null, status: 'running',
      iniciadoEm: entry.iniciadoEm, finalizadoEm: null, erro: null
    })

    try {
      // Cria conversa temporária e roda o bot destino SÓ com a tarefa (sem histórico)
      const stamp = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      const conv = insertConversation(db, botDestinoId, 'handoff', `Delegação · ${stamp}`)
      const reply = await chat.send(conv.id, tarefa, { delegationDepth: depth + 1, delegationStack: [...callStack, botDestinoId] })
      const resposta = reply.content

      finishDelegation(db, entry.id, { resposta })
      const finished = getDelegation(db, entry.id)!
      onCard({
        id: entry.id, conversaId, botDestinoNome: destAgent.name,
        tarefa, resposta, status: 'ok',
        iniciadoEm: finished.iniciadoEm, finalizadoEm: finished.finalizadoEm, erro: null
      })
      return resposta
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err)
      finishDelegation(db, entry.id, { erro })
      const finished = getDelegation(db, entry.id)!
      onCard({
        id: entry.id, conversaId, botDestinoNome: destAgent.name,
        tarefa, resposta: null, status: 'error',
        iniciadoEm: finished.iniciadoEm, finalizadoEm: finished.finalizadoEm, erro
      })
      throw err
    }
  }
}

// Extrai blocos {"delegar":{"para":"Nome","tarefa":"..."}} do texto do assistente.
// Retorna lista na ordem de aparição.
export function extractDelegations(text: string): Array<{ para: string; tarefa: string }> {
  const results: Array<{ para: string; tarefa: string }> = []
  const re = /\{"delegar"\s*:\s*\{[^}]*"para"\s*:\s*"([^"]+)"[^}]*"tarefa"\s*:\s*"([^"]+)"[^}]*\}}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    results.push({ para: m[1]!, tarefa: m[2]! })
  }
  return results
}

// Extrai @NomeDoBot tarefa do texto do usuário.
export function extractManualDelegation(text: string): { para: string; tarefa: string } | null {
  const m = /^@(\S+)\s+(.+)/s.exec(text.trim())
  return m ? { para: m[1]!, tarefa: m[2]!.trim() } : null
}
