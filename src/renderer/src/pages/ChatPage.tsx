import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, Conversation, DelegationCard, McpApprovalRequest, McpToolCallEvent, Message } from '@shared/types'
import { api, formatDateTime } from '../api'
import type { ChatTarget } from '../App'
import { CloseButton, useCloseHandler } from '../CloseContext'
import { useToast } from '../toast'

interface Props {
  agents: Agent[]
  target: ChatTarget | null
  onOpenChat: (agentId: number, conversationId: number | null) => void
}

// "routine" cobre rotinas e fluxos: tudo que roda sozinho
const originLabels = { manual: '', handoff: 'repasse', routine: 'automação' } as const

export function ChatPage({ agents, target, onOpenChat }: Props) {
  const toast = useToast()
  const [agentId, setAgentId] = useState<number | null>(target?.agentId ?? agents[0]?.id ?? null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationId, setConversationId] = useState<number | null>(target?.conversationId ?? null)
  const [messages, setMessages] = useState<Message[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [sending, setSending] = useState(false)
  const [sendingConvId, setSendingConvId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [handoffFor, setHandoffFor] = useState<number | null>(null)
  const [delegCards, setDelegCards] = useState<DelegationCard[]>([])
  const [mcpToolCalls, setMcpToolCalls] = useState<McpToolCallEvent[]>([])
  const [mcpApproval, setMcpApproval] = useState<McpApprovalRequest | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const clearDraft = useCallback(
    (id: number) =>
      setDrafts((d) => {
        if (!(id in d)) return d
        const { [id]: _removed, ...rest } = d
        return rest
      }),
    []
  )

  const agent = agents.find((a) => a.id === agentId) ?? null
  const agentName = (id: number | null) => agents.find((a) => a.id === id)?.name ?? 'agente removido'

  // Navegação vinda de outra tela (Execuções, Agentes, repasse).
  useEffect(() => {
    if (!target) return
    setAgentId(target.agentId)
    setConversationId(target.conversationId)
  }, [target])

  const loadConversations = useCallback(async () => {
    if (agentId === null) return setConversations([])
    setConversations(await api.conversations.list(agentId))
  }, [agentId])

  const loadMessages = useCallback(async () => {
    if (conversationId === null) { setMessages([]); setHasMore(false); return }
    const msgs = await api.conversations.messages(conversationId)
    setMessages(msgs)
    setHasMore(msgs.length === 50)
  }, [conversationId])

  const loadMore = useCallback(async () => {
    if (conversationId === null || messages.length === 0) return
    const older = await api.conversations.messages(conversationId, messages[0].id)
    setMessages((prev) => [...older, ...prev])
    setHasMore(older.length === 50)
  }, [conversationId, messages])

  useEffect(() => {
    loadConversations().catch(toast.error)
  }, [loadConversations, toast.error])

  useEffect(() => {
    loadMessages().catch(toast.error)
  }, [loadMessages, toast.error])

  const openConversationRef = useRef(conversationId)
  openConversationRef.current = conversationId

  // Streaming throttle: accumulate deltas and flush at most every 50ms.
  const pendingDrafts = useRef<Record<number, string>>({})
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDrafts = useCallback(() => {
    flushTimer.current = null
    const pending = pendingDrafts.current
    if (Object.keys(pending).length === 0) return
    pendingDrafts.current = {}
    setDrafts((d) => {
      const next = { ...d }
      for (const [k, v] of Object.entries(pending)) next[Number(k)] = (next[Number(k)] ?? '') + v
      return next
    })
  }, [])

  useEffect(
    () =>
      api.chat.onChunk(({ conversationId: id, delta, done }) => {
        if (!done) {
          pendingDrafts.current[id] = (pendingDrafts.current[id] ?? '') + delta
          if (!flushTimer.current) flushTimer.current = setTimeout(flushDrafts, 50)
          return
        }
        // Final chunk: flush pending, then reload messages from DB
        if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
        pendingDrafts.current = {}
        if (id === openConversationRef.current) {
          api.conversations
            .messages(id)
            .then((m) => { setMessages(m); setHasMore(m.length === 50); clearDraft(id) })
            .catch(() => clearDraft(id))
        } else {
          clearDraft(id)
        }
      }),
    [flushDrafts]
  )

  // Rotinas criam conversas novas: mantém a lista atualizada.
  useEffect(() => api.routines.onRunsChanged(() => void loadConversations().catch(() => undefined)), [loadConversations])

  // Atualiza cartões de delegação em tempo real
  useEffect(() => api.delegation.onCard((card) => {
    if (card.conversaId !== conversationId) return
    setDelegCards((prev) => {
      const idx = prev.findIndex((c) => c.id === card.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = card; return next }
      return [...prev, card]
    })
  }), [conversationId])

  // Limpa cartões ao trocar de conversa
  useEffect(() => { setDelegCards([]); setMcpToolCalls([]) }, [conversationId])

  // Cartões de chamada de ferramenta MCP em tempo real
  useEffect(() => api.mcp.onToolCall((event) => {
    if (event.conversationId !== conversationId) return
    setMcpToolCalls((prev) => {
      // Update existing entry or add new
      const idx = prev.findIndex((e) => e.serverName === event.serverName && e.toolName === event.toolName && e.status === 'calling')
      if (idx >= 0 && event.status !== 'calling') { const next = [...prev]; next[idx] = event; return next }
      return [...prev, event]
    })
  }), [conversationId])

  // Pedido de aprovação MCP
  useEffect(() => api.mcp.onApprovalRequest((req) => {
    if (req.conversationId !== conversationId) return
    setMcpApproval(req)
  }), [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, drafts, conversationId])

  async function newConversation() {
    if (agentId === null) return
    try {
      const c = await api.conversations.create(agentId)
      await loadConversations()
      setConversationId(c.id)
    } catch (err) {
      toast.error(err)
    }
  }

  async function send() {
    const content = text.trim()
    if (!content || sending || agentId === null) return
    setSending(true)
    let id = conversationId
    try {
      if (id === null) {
        id = (await api.conversations.create(agentId)).id
        setConversationId(id)
      }
      setSendingConvId(id)
      setText('')
      setMessages((m) => [...m, optimistic(id!, content)])
      await api.chat.send(id, content)
    } catch (err) {
      toast.error(err)
    } finally {
      setSendingConvId(null)
      // Em caso de erro a mensagem do usuário continua gravada; recarrega para refletir isso.
      if (id !== null) {
        const m = await api.conversations.messages(id).catch(() => [] as Message[])
        setMessages(m); setHasMore(m.length === 50)
      }
      await loadConversations().catch(() => undefined)
      setSending(false)
    }
  }

  async function removeConversation(id: number) {
    if (!confirm('Excluir esta conversa?')) return
    try {
      await api.conversations.remove(id)
      if (id === conversationId) setConversationId(null)
      await loadConversations()
    } catch (err) {
      toast.error(err)
    }
  }

  // O texto digitado e não enviado fica no campo, então fechar a conversa não perde nada.
  useCloseHandler(() => {
    if (conversationId === null) return 'nothing'
    setConversationId(null)
    setHandoffFor(null)
    return 'closed'
  })

  if (agents.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Nenhum agente</h2>
        <p>Crie um agente na aba Agentes para começar a conversar.</p>
      </div>
    )
  }

  const draft = conversationId !== null ? drafts[conversationId] : undefined
  const waiting = sending && draft === undefined

  return (
    <div className="page split">
      <aside className="list-pane">
        <div className="pane-header column">
          <select
            value={agentId ?? ''}
            onChange={(e) => {
              setAgentId(Number(e.target.value))
              setConversationId(null)
            }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button onClick={() => void newConversation()}>+ Nova conversa</button>
        </div>
        <ul className="item-list">
          {conversations.map((c) => (
            <li key={c.id} className="item-row">
              <button
                className={`item ${conversationId === c.id ? 'active' : ''}`}
                onClick={() => setConversationId(c.id)}
              >
                <span className="item-title">{c.title}</span>
                <span className="item-sub">
                  {formatDateTime(c.updatedAt)}
                  {originLabels[c.origin] && <span className="tag">{originLabels[c.origin]}</span>}
                </span>
              </button>
              <button className="icon" title="Excluir conversa" onClick={() => void removeConversation(c.id)}>
                ×
              </button>
            </li>
          ))}
          {conversations.length === 0 && <li className="muted pad">Sem conversas.</li>}
        </ul>
      </aside>

      <section className="chat-pane">
        <header className="chat-header">
          {agent && <span className="dot" style={{ background: agent.color }} />}
          <strong>{agent?.name}</strong>
          <span className="muted">{agent?.model}</span>
          {conversationId !== null && <CloseButton label="Fechar conversa" />}
        </header>

        <div className="messages">
          {hasMore && (
            <div className="muted center">
              <button className="link" onClick={() => void loadMore().catch(toast.error)}>Carregar mensagens anteriores</button>
            </div>
          )}
          {messages.length === 0 && !draft && (
            <div className="muted center">Envie uma mensagem para {agent?.name}.</div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              agentName={agentName}
              handoffFor={handoffFor}
              agentId={agentId}
              agents={agents}
              onToggleHandoff={(id) => setHandoffFor(handoffFor === id ? null : id)}
              onHandoffDone={(toAgentId, newConversationId) => { setHandoffFor(null); onOpenChat(toAgentId, newConversationId) }}
              onHandoffCancel={() => setHandoffFor(null)}
            />
          ))}
          {delegCards.map((card) => (
            <DelegationCardView key={card.id} card={card} />
          ))}
          {mcpToolCalls.map((ev, i) => (
            <McpToolCallCard key={i} event={ev} />
          ))}
          {mcpApproval && (
            <McpApprovalCard
              req={mcpApproval}
              onRespond={async (approved) => {
                setMcpApproval(null)
                await api.mcp.approvalRespond(mcpApproval.requestId, approved).catch(() => undefined)
              }}
            />
          )}
          {draft !== undefined && (
            <div className="bubble assistant streaming">
              <div className="bubble-text">{draft}</div>
            </div>
          )}
          {waiting && <div className="bubble assistant streaming muted">Pensando…</div>}
          <div ref={bottomRef} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={`Mensagem para ${agent?.name ?? ''} (Enter envia, Shift+Enter quebra linha)`}
            rows={3}
            disabled={sending}
          />
          {sending && sendingConvId !== null && (
            <button type="button" onClick={() => void api.chat.stop(sendingConvId)}>
              Parar
            </button>
          )}
          <button type="submit" className="primary" disabled={sending || !text.trim()}>
            Enviar
          </button>
        </form>
      </section>
    </div>
  )
}

interface BubbleProps {
  message: Message
  agentName: (id: number | null) => string
  handoffFor: number | null
  agentId: number | null
  agents: Agent[]
  onToggleHandoff: (id: number) => void
  onHandoffDone: (toAgentId: number, conversationId: number) => void
  onHandoffCancel: () => void
}

const MessageBubble = memo(function MessageBubble({
  message: m, agentName, handoffFor, agentId, agents, onToggleHandoff, onHandoffDone, onHandoffCancel
}: BubbleProps) {
  return (
    <div className={`bubble ${m.role}`}>
      {m.fromAgentId !== null && <div className="bubble-meta">repassado de {agentName(m.fromAgentId)}</div>}
      <div className="bubble-text">{m.content || <em className="muted">(resposta vazia)</em>}</div>
      {m.role === 'assistant' && m.id > 0 && (
        <div className="bubble-actions">
          {m.tokensOut !== null && <span className="muted">{m.tokensOut} tokens</span>}
          <button className="link" onClick={() => onToggleHandoff(m.id)}>Enviar para…</button>
        </div>
      )}
      {handoffFor === m.id && agentId !== null && (
        <HandoffPanel
          messageId={m.id}
          agents={agents.filter((a) => a.id !== agentId)}
          onDone={onHandoffDone}
          onCancel={onHandoffCancel}
        />
      )}
    </div>
  )
})

function DelegationCardView({ card }: { card: DelegationCard }) {
  const [open, setOpen] = useState(false)
  const elapsed = card.finalizadoEm
    ? `${((new Date(card.finalizadoEm).getTime() - new Date(card.iniciadoEm).getTime()) / 1000).toFixed(1)}s`
    : '…'
  const statusLabel = card.status === 'running' ? 'rodando' : card.status === 'ok' ? 'ok' : 'erro'
  return (
    <div className={`delegation-card status-${card.status}`}>
      <button className="delegation-header" onClick={() => setOpen((o) => !o)}>
        <span>↪ Delegado para <strong>{card.botDestinoNome}</strong></span>
        <span className="delegation-meta">{statusLabel} · {elapsed}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="delegation-body">
          <div className="delegation-section">
            <span className="muted small">Tarefa</span>
            <div>{card.tarefa}</div>
          </div>
          {card.resposta && (
            <div className="delegation-section">
              <span className="muted small">Resposta</span>
              <div>{card.resposta}</div>
            </div>
          )}
          {card.erro && (
            <div className="delegation-section error-text">
              <span className="muted small">Erro</span>
              <div>{card.erro}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function McpToolCallCard({ event: ev }: { event: McpToolCallEvent }) {
  const [open, setOpen] = useState(false)
  const statusIcon = ev.status === 'calling' ? '⟳' : ev.status === 'done' ? '✓' : ev.status === 'denied' ? '✕' : '⚠'
  return (
    <div className={`delegation-card status-${ev.status === 'done' ? 'ok' : ev.status === 'calling' ? 'running' : 'error'}`}>
      <button className="delegation-header" onClick={() => setOpen((o) => !o)}>
        <span>{statusIcon} MCP <strong>{ev.toolName}</strong> @ {ev.serverName}</span>
        <span className="delegation-meta">{ev.result ? `${ev.result.durationMs}ms` : '…'}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="delegation-body">
          <div className="delegation-section">
            <span className="muted small">Argumentos</span>
            <pre style={{ margin: 0, fontSize: '0.8rem' }}>{JSON.stringify(ev.args, null, 2)}</pre>
          </div>
          {ev.result && (
            <div className="delegation-section">
              <span className="muted small">Resultado</span>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{ev.result.content.slice(0, 500)}{ev.result.content.length > 500 ? '…' : ''}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function McpApprovalCard({ req, onRespond }: { req: McpApprovalRequest; onRespond: (approved: boolean) => Promise<void> }) {
  const [done, setDone] = useState(false)
  async function respond(approved: boolean) { setDone(true); await onRespond(approved) }
  return (
    <div className="delegation-card status-running">
      <div className="delegation-header" style={{ cursor: 'default' }}>
        <span>🔐 Aprovação necessária: <strong>{req.toolName}</strong> @ {req.serverName}</span>
      </div>
      <div className="delegation-body">
        <div className="delegation-section">
          <span className="muted small">Argumentos</span>
          <pre style={{ margin: 0, fontSize: '0.8rem' }}>{JSON.stringify(req.args, null, 2)}</pre>
        </div>
        {!done && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button onClick={() => void respond(true)} className="primary">Aprovar</button>
            <button onClick={() => void respond(false)} className="danger">Negar</button>
          </div>
        )}
        {done && <span className="muted small">Respondido</span>}
      </div>
    </div>
  )
}

function optimistic(conversationId: number, content: string): Message {
  return {
    id: -Date.now(),
    conversationId,
    role: 'user',
    content,
    fromAgentId: null,
    tokensIn: null,
    tokensOut: null,
    createdAt: new Date().toISOString()
  }
}

interface HandoffProps {
  messageId: number
  agents: Agent[]
  onDone: (toAgentId: number, conversationId: number) => void
  onCancel: () => void
}

function HandoffPanel({ messageId, agents, onDone, onCancel }: HandoffProps) {
  const toast = useToast()
  const [toAgentId, setToAgentId] = useState<number | null>(agents[0]?.id ?? null)
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)

  if (agents.length === 0) {
    return <div className="handoff muted">Crie outro agente para poder repassar respostas.</div>
  }

  async function run() {
    if (toAgentId === null) return
    setRunning(true)
    try {
      const result = await api.chat.handoff({ messageId, toAgentId, instruction })
      onDone(toAgentId, result.conversationId)
    } catch (err) {
      toast.error(err)
      setRunning(false)
    }
  }

  return (
    <div className="handoff">
      <div className="row">
        <label>
          Para
          <select value={toAgentId ?? ''} onChange={(e) => setToAgentId(Number(e.target.value))} disabled={running}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Instrução (opcional)
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="ex.: Revise e aponte erros"
            disabled={running}
          />
        </label>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => void run()} disabled={running}>
          {running ? 'Aguardando resposta…' : 'Repassar'}
        </button>
        <button onClick={onCancel} disabled={running}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
