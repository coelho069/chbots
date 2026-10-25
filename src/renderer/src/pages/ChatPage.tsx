import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Agent, Attachment, Conversation, DelegationCard, McpApprovalRequest, McpToolCallEvent, Message, SendDraft } from '@shared/types'
import { api, formatDateTime } from '../api'
import type { ChatTarget } from '../App'
import { CloseButton, useCloseHandler } from '../CloseContext'
import { useToast } from '../toast'
import { MarkdownContent } from '../components/MarkdownContent'

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
  const [mcpApprovals, setMcpApprovals] = useState<McpApprovalRequest[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sendDrafts, setSendDrafts] = useState<SendDraft[]>([])
  const [sendError, setSendError] = useState<{ conversationId: number; content: string; message: string } | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [respondingApprovals, setRespondingApprovals] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const approvalFocusRef = useRef<HTMLButtonElement>(null)

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
    const older = await api.conversations.messages(conversationId, messages[0]!.id)
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

  // Rascunhos de envio externo pendentes
  useEffect(() => api.drafts.onPending((draft) => {
    if (draft.conversationId === conversationId) {
      setSendDrafts((prev) => [...prev, draft])
    }
  }), [conversationId])

  // Limpa cartões ao trocar de conversa
  useEffect(() => {
    setDelegCards([])
    setMcpToolCalls([])
    setSendDrafts([])
    setApprovalError(null)
    setSendError(null)
  }, [conversationId])

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
    setMcpApprovals((prev) => prev.some((item) => item.requestId === req.requestId) ? prev : [...prev, req])
  }), [])

  useEffect(() => {
    void api.mcp.pendingApprovals().then((pending) => {
      setMcpApprovals(pending)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, drafts, conversationId])

  const conversationApprovals = mcpApprovals.filter((req) => req.conversationId === conversationId)
  const visibleApprovals = mcpApprovals

  useEffect(() => {
    if (visibleApprovals.length > 0) {
      approvalFocusRef.current?.focus()
      approvalFocusRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [visibleApprovals.length])

  async function respondApproval(req: McpApprovalRequest, approved: boolean) {
    setApprovalError(null)
    setRespondingApprovals((prev) => [...prev, req.requestId])
    try {
      await api.mcp.approvalRespond(req.requestId, approved)
      setMcpApprovals((prev) => prev.filter((item) => item.requestId !== req.requestId))
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : String(err))
    } finally {
      setRespondingApprovals((prev) => prev.filter((id) => id !== req.requestId))
    }
  }

  async function respondMany(requests: McpApprovalRequest[], approved: boolean) {
    if (requests.length === 0) return
    setApprovalError(null)
    const ids = requests.map((req) => req.requestId)
    setRespondingApprovals((prev) => [...new Set([...prev, ...ids])])
    const results = await Promise.allSettled(requests.map((req) => api.mcp.approvalRespond(req.requestId, approved)))
    const completed = new Set(requests.filter((_, index) => results[index]?.status === 'fulfilled').map((req) => req.requestId))
    setMcpApprovals((prev) => prev.filter((req) => !completed.has(req.requestId)))
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') setApprovalError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason))
    setRespondingApprovals((prev) => prev.filter((id) => !ids.includes(id)))
  }

  async function approveConversation() {
    if (conversationId === null) return
    setApprovalError(null)
    try {
      await api.mcp.approveConversation(conversationId, true)
      setMcpApprovals((prev) => prev.filter((req) => req.conversationId !== conversationId))
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : String(err))
    }
  }

  async function alwaysAllow(req: McpApprovalRequest) {
    const targetAgentId = req.agentId ?? agentId
    if (targetAgentId === null) return
    setApprovalError(null)
    setRespondingApprovals((prev) => [...prev, req.requestId])
    try {
      await api.mcp.alwaysAllow(targetAgentId, req.serverName, req.toolName)
      setMcpApprovals((prev) => prev.filter((item) => item.requestId !== req.requestId))
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : String(err))
    } finally {
      setRespondingApprovals((prev) => prev.filter((id) => id !== req.requestId))
    }
  }

  function addFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { toast.error('Arquivo maior que 10 MB'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const data = (reader.result as string).split(',')[1] ?? ''
      setAttachments((prev) => [...prev, { name: file.name, mediaType: file.type || 'application/octet-stream', data, size: file.size }])
    }
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      items.filter((i) => i.kind === 'file').forEach((i) => { const f = i.getAsFile(); if (f) addFile(f) })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

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
    setSendError(null)
    let id = conversationId
    try {
      if (id === null) {
        id = (await api.conversations.create(agentId)).id
        setConversationId(id)
      }
      setSendingConvId(id)
      setText('')
      setAttachments([])
      setMessages((m) => [...m, optimistic(id!, content)])
      await api.chat.send(id, content, attachments.length > 0 ? attachments : undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSendError({ conversationId: id ?? -1, content, message })
      toast.error(message)
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

  async function retryFailedMessage() {
    if (!sendError || sending) return
    const failed = sendError
    setSendError(null)
    setSending(true)
    setSendingConvId(failed.conversationId)
    try {
      await api.chat.send(failed.conversationId, failed.content)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSendError({ ...failed, message })
      toast.error(message)
    } finally {
      setSendingConvId(null)
      const loaded = await api.conversations.messages(failed.conversationId).catch(() => [] as Message[])
      setMessages(loaded)
      setHasMore(loaded.length === 50)
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
  const activeMcpCall = mcpToolCalls.find((event) => event.status === 'calling')
  const waitingLabel = visibleApprovals.length > 0
    ? 'Aguardando aprovação…'
    : activeMcpCall
      ? `Chamando ${activeMcpCall.toolName}…`
      : 'Pensando…'

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
          {visibleApprovals.length > 0 && <span className="mcp-approval-top-warning" role="status">Aguardando sua aprovação ({visibleApprovals.length})</span>}
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
          {sendDrafts.map((d) => (
            <DraftCard key={d.id} draft={d}
              onRespond={() => setSendDrafts((prev) => prev.filter((x) => x.id !== d.id))} />
          ))}
          {draft !== undefined && (
            <div className="bubble assistant streaming">
              <div className="bubble-text">{draft}</div>
            </div>
          )}
          {waiting && <div className="bubble assistant streaming muted" aria-live="polite">{waitingLabel}</div>}
          <div className="small muted center" aria-live="polite">
            {draft !== undefined && 'Resposta em streaming...'}
          </div>
          {sendError && sendError.conversationId === conversationId && (
            <div className="delegation-card status-error" role="alert">
              <div className="delegation-header" style={{ cursor: 'default' }}>
                <span>⚠ Não foi possível concluir a resposta</span>
              </div>
              <div className="delegation-body">
                <div className="error-text">{sendError.message}</div>
                <button className="primary" onClick={() => void retryFailedMessage()} disabled={sending}>Tentar de novo</button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {visibleApprovals.length > 0 && (
          <section
            className="mcp-approval-dock"
            aria-label="Aprovações MCP pendentes"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                void respondApproval(visibleApprovals[0]!, false)
              }
              if (event.key === 'Enter' && event.target === event.currentTarget) {
                event.preventDefault()
                void respondApproval(visibleApprovals[0]!, true)
              }
            }}
          >
            <div className="mcp-approval-banner" role="status">
              <strong>⚠ Aprovação necessária</strong>
              <span>{visibleApprovals.length} {visibleApprovals.length === 1 ? 'chamada pendente' : 'chamadas pendentes'}</span>
              <span className="muted small">Enter aprova · Esc recusa</span>
            </div>
            <div className="mcp-approval-actions">
              <button className="primary" onClick={() => void approveConversation()} disabled={respondingApprovals.length > 0 || conversationApprovals.length === 0}>Aprovar todos desta conversa ({conversationApprovals.length})</button>
              <button onClick={() => void respondMany(mcpApprovals, true)} disabled={respondingApprovals.length > 0}>Aprovar todas pendentes ({mcpApprovals.length})</button>
              <button className="danger" onClick={() => void respondMany(mcpApprovals, false)} disabled={respondingApprovals.length > 0}>Recusar todas</button>
            </div>
            {approvalError && <div className="error-text" role="alert">Não foi possível registrar uma decisão: {approvalError}</div>}
            <div className="mcp-approval-list">
              {visibleApprovals.map((req, index) => (
                <McpApprovalCard
                  key={req.requestId}
                  req={req}
                  onRespond={(approved) => void respondApproval(req, approved)}
                  responding={respondingApprovals.includes(req.requestId)}
                  approveRef={index === 0 ? approvalFocusRef : undefined}
                  onAlwaysAllow={() => void alwaysAllow(req)}
                />
              ))}
            </div>
          </section>
        )}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {delegCards.filter(c => c.status === 'running').length > 0 && (
            <div className="bg-tasks-badge">
              {delegCards.filter(c => c.status === 'running').length} tarefa(s) em segundo plano
            </div>
          )}
          <label className="attach-btn" title="Anexar arquivo (imagem ou PDF)">
            <input type="file" accept="image/*,.pdf" multiple style={{ display: 'none' }}
              onChange={(e) => Array.from(e.target.files ?? []).forEach(addFile)} />
            📎
          </label>
          {attachments.length > 0 && (
            <div className="attachments-preview">
              {attachments.map((a, i) => (
                <span key={i} className="attachment-chip">
                  {a.name} <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
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
      <div className="bubble-text">{m.content ? <MarkdownContent source={m.content} /> : <em className="muted">(resposta vazia)</em>}</div>
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
  const statusLabel = ev.status === 'calling' ? 'Executando' : ev.status === 'done' ? 'Concluída' : ev.status === 'denied' ? 'Negada' : 'Erro'
  const statusIcon = ev.status === 'calling' ? '⟳' : ev.status === 'done' ? '✓' : ev.status === 'denied' ? '✕' : '⚠'
  return (
    <div className={`delegation-card status-${ev.status === 'done' ? 'ok' : ev.status === 'calling' ? 'running' : 'error'}`} aria-live="polite">
      <button className="delegation-header" onClick={() => setOpen((o) => !o)}>
        <span>{statusIcon} MCP <strong>{ev.toolName}</strong> @ {ev.serverName}</span>
        <span className="delegation-meta">{statusLabel} {ev.result ? `· ${ev.result.durationMs}ms` : ''}</span>
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

function McpApprovalCard({ req, onRespond, responding, approveRef, onAlwaysAllow }: { req: McpApprovalRequest; onRespond: (approved: boolean) => void; responding: boolean; approveRef?: RefObject<HTMLButtonElement | null>; onAlwaysAllow: () => void }) {
  const [showArgs, setShowArgs] = useState(false)
  const summary = JSON.stringify(req.args)
  const dangerous = /(?:write_file|edit_file|move_file|git_commit|delete|remove|unlink|erase)/i.test(req.toolName)
  return (
    <div className="mcp-approval-card" data-request-id={req.requestId}>
      <div className="mcp-approval-card-header">
        <span>🔐 <strong>{req.toolName}</strong> @ {req.serverName}</span>
        <span className="delegation-meta">pendente</span>
      </div>
      <div className="mcp-approval-card-body">
        <div className="delegation-section">
          <span className="muted small">Argumentos</span>
          <pre className="mcp-approval-args">{showArgs ? JSON.stringify(req.args, null, 2) : summary.length > 180 ? `${summary.slice(0, 180)}…` : summary}</pre>
          {summary.length > 180 && <button className="link small" onClick={() => setShowArgs((open) => !open)}>{showArgs ? 'Ver menos' : 'Ver tudo'}</button>}
        </div>
        {dangerous && <div className="mcp-risk-warning mcp-risk-warning-danger" role="alert">Atenção: esta ferramenta pode alterar ou apagar dados. Só marque como sempre aprovada se confiar nela.</div>}
        <div className="mcp-approval-card-actions">
          <button ref={approveRef} onClick={() => onRespond(true)} className="primary" disabled={responding}>{responding ? 'Enviando…' : 'Aprovar'}</button>
          <button onClick={() => onRespond(false)} className="danger" disabled={responding}>Recusar</button>
          <button onClick={onAlwaysAllow} disabled={responding} title="Salva esta permissão no agente">Sempre aprovar esta ferramenta neste agente</button>
        </div>
      </div>
    </div>
  )
}

function DraftCard({ draft, onRespond }: { draft: SendDraft; onRespond: (approve: boolean) => void }) {
  const [responding, setResponding] = useState(false)
  async function respond(approve: boolean) {
    setResponding(true)
    try {
      await api.drafts.respond(draft.id, approve)
      onRespond(approve)
    } finally {
      setResponding(false)
    }
  }
  return (
    <div className="delegation-card status-running">
      <div className="delegation-header" style={{ cursor: 'default' }}>
        <strong>{draft.tool === 'send_email' ? 'E-mail' : 'Slack'}: {draft.recipient}</strong>
      </div>
      <div className="delegation-body">
        {draft.subject && <div className="delegation-section"><span className="muted small">Assunto</span><div>{draft.subject}</div></div>}
        <div className="delegation-section"><span className="muted small">Mensagem</span><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{draft.body}</pre></div>
        <div className="mcp-approval-card-actions">
          <button className="primary" disabled={responding} onClick={() => void respond(true)}>Enviar</button>
          <button className="danger" disabled={responding} onClick={() => void respond(false)}>Descartar</button>
        </div>
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
