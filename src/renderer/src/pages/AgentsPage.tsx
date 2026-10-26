import { useEffect, useRef, useState } from 'react'
import type { Agent, AgentInput, DelegationConfig, McpServerInfo, Provider } from '@shared/types'
import { api } from '../api'
import { CloseButton, useCloseHandler } from '../CloseContext'
import { confirmUnsaved, sameFields } from '../closeCurrent'
import { useToast } from '../toast'
import { getMcpDescricaoPtBR } from '@shared/mcpDescricoesPtBR'
import { McpTranslatedDescription } from '../components/McpTranslatedDescription'

const agentFields: (keyof AgentInput)[] = ['name', 'color', 'systemPrompt', 'providerId', 'model', 'temperature', 'usarCache', 'mcpTools', 'verificarFontes', 'verificadorProviderId', 'verificadorModel']

const palette = ['#4f7cff', '#16a37f', '#e0703a', '#c2459b', '#8a63d2', '#d4a62a', '#3a9fc4', '#d04f4f']

interface Props {
  agents: Agent[]
  providers: Provider[]
  // rascunho vindo do Gerador de Prompts: abre "Novo agente" já preenchido
  draft?: Partial<AgentInput> | null
  onDraftUsed?: () => void
  onChanged: () => Promise<void>
  onOpenChat: (agentId: number) => void
  onGoSettings: () => void
}

const emptyForm = (providers: Provider[], index: number): AgentInput => ({
  name: '',
  color: palette[index % palette.length]!,
  systemPrompt: '',
  providerId: providers[0]?.id ?? 0,
  model: '',
  temperature: 0.7,
  usarCache: false,
  mcpTools: [],
  verificarFontes: false,
  verificadorProviderId: null,
  verificadorModel: null
})

export function AgentsPage({ agents, providers, draft, onDraftUsed, onChanged, onOpenChat, onGoSettings }: Props) {
  const toast = useToast()
  // vale até o usuário sair do "Novo agente"; não é zerado no efeito para sobreviver ao StrictMode
  const draftRef = useRef(draft ?? null)
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(draft ? 'new' : (agents[0]?.id ?? 'new'))
  const [form, setForm] = useState<AgentInput>(() => emptyForm(providers, agents.length))
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [delCfg, setDelCfg] = useState<DelegationConfig | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([])
  const [alwaysApproved, setAlwaysApproved] = useState<{ serverName: string; toolName: string }[]>([])

  useEffect(() => {
    if (draft) onDraftUsed?.()
  }, [draft, onDraftUsed])

  useEffect(() => {
    if (selectedId === 'new' || selectedId === null) {
      const base = emptyForm(providers, agents.length)
      const d = draftRef.current
      const providerOk = d?.providerId !== undefined && providers.some((p) => p.id === d.providerId)
      setForm(d ? { ...base, ...d, providerId: providerOk ? d.providerId! : base.providerId } : base)
      return
    }
    draftRef.current = null
    const a = agents.find((x) => x.id === selectedId)
    if (a) setForm({ ...a, mcpTools: a.mcpTools ?? [], verificarFontes: a.verificarFontes ?? false, verificadorProviderId: a.verificadorProviderId ?? null, verificadorModel: a.verificadorModel ?? null })
    // Carrega config de delegação ao trocar de agente
    if (typeof selectedId === 'number') {
      void api.delegation.getConfig(selectedId).then(setDelCfg).catch(() => setDelCfg(null))
    } else {
      setDelCfg(null)
    }
    // Recarrega o formulário só ao trocar de agente, não a cada salvamento.
  }, [selectedId])

  useEffect(() => setModels([]), [form.providerId])

  useEffect(() => { api.mcp.list().then(setMcpServers).catch(() => undefined) }, [])

  useEffect(() => {
    if (typeof selectedId !== 'number') {
      setAlwaysApproved([])
      return
    }
    void api.mcp.getApprovals(selectedId).then((approvals) => {
      setAlwaysApproved(Object.entries(approvals)
        .filter(([, value]) => value === 'allow')
        .map(([key]) => {
          const separator = key.lastIndexOf('::')
          return { serverName: key.slice(0, separator), toolName: key.slice(separator + 2) }
        }))
    }).catch(() => setAlwaysApproved([]))
  }, [selectedId])

  // Ctrl+B: fecha o agente em edição; no formulário de novo agente não há item aberto (volta ao início).
  useCloseHandler(async () => {
    const editingAgent = typeof selectedId === 'number' ? agents.find((a) => a.id === selectedId) : undefined
    const baseline = editingAgent ?? emptyForm(providers, agents.length)
    if (!sameFields(form, baseline, agentFields)) {
      const detail = editingAgent ? `O agente "${editingAgent.name}" tem alterações não salvas.` : 'O novo agente ainda não foi salvo.'
      if (!(await confirmUnsaved(api.app.askUnsaved, detail, save))) return 'cancelled'
    }
    if (!editingAgent) return 'nothing'
    draftRef.current = null
    setSelectedId('new')
    return 'closed'
  })

  if (providers.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Nenhum provedor de modelo</h2>
        <p>Cadastre um provedor (OpenAI, Anthropic ou Ollama) antes de criar agentes.</p>
        <button className="primary" onClick={onGoSettings}>
          Ir para Configurações
        </button>
      </div>
    )
  }

  const set = <K extends keyof AgentInput>(key: K, value: AgentInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function loadModels() {
    setLoadingModels(true)
    try {
      const list = await api.providers.listModels(form.providerId)
      setModels(list)
      if (list.length === 0) toast.info('O provedor não retornou modelos')
    } catch (err) {
      toast.error(err)
    } finally {
      setLoadingModels(false)
    }
  }

  async function save(): Promise<boolean> {
    setSaving(true)
    try {
      const saved = selectedId === 'new' || selectedId === null
        ? await api.agents.create(form)
        : await api.agents.update(selectedId, form)
      // Salva config de delegação se carregada
      if (delCfg) await api.delegation.saveConfig({ ...delCfg, agentId: saved.id })
      await onChanged()
      setSelectedId(saved.id)
      toast.info('Agente salvo')
      return true
    } catch (err) {
      toast.error(err)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function duplicate(id: number) {
    try {
      const copy = await api.agents.duplicate(id)
      await onChanged()
      setSelectedId(copy.id)
    } catch (err) {
      toast.error(err)
    }
  }

  async function remove(id: number) {
    if (!confirm('Excluir este agente, suas conversas e rotinas de origem?')) return
    try {
      await api.agents.remove(id)
      await onChanged()
      setSelectedId('new')
    } catch (err) {
      toast.error(err)
    }
  }

  async function removeAlwaysApproved(item: { serverName: string; toolName: string }) {
    if (typeof selectedId !== 'number') return
    try {
      await api.mcp.setApproval(selectedId, item.serverName, item.toolName, 'ask')
      setAlwaysApproved((prev) => prev.filter((entry) => entry.serverName !== item.serverName || entry.toolName !== item.toolName))
    } catch (err) {
      toast.error(err)
    }
  }

  const editing = typeof selectedId === 'number'

  return (
    <div className="page split">
      <aside className="list-pane">
        <div className="pane-header">
          <h2>Agentes</h2>
          <button onClick={() => setSelectedId('new')}>+ Novo</button>
        </div>
        <ul className="item-list">
          {agents.map((a) => (
            <li key={a.id}>
              <button className={`item ${selectedId === a.id ? 'active' : ''}`} onClick={() => setSelectedId(a.id)}>
                <span className="dot" style={{ background: a.color }} />
                <span className="item-title">{a.name}</span>
                <span className="item-sub">{a.model}</span>
              </button>
            </li>
          ))}
          {agents.length === 0 && <li className="muted pad">Nenhum agente ainda.</li>}
        </ul>
      </aside>

      <section className="detail-pane">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="row-between">
            <h2>{editing ? 'Editar agente' : 'Novo agente'}</h2>
            {editing && <CloseButton label="Fechar agente" />}
          </div>
          {!editing && draftRef.current && (
            <p className="muted small">Preenchido pelo Gerador de Prompts. Revise e clique em Salvar para criar o agente.</p>
          )}

          <label>
            Nome
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} />
          </label>

          <div className="field">
            <span>Cor</span>
            <div className="swatches">
              {palette.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${form.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => set('color', c)}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </div>

          <label>
            Prompt de sistema
            <textarea
              rows={8}
              value={form.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              placeholder="Quem é este agente, como deve responder, o que deve evitar…"
            />
          </label>

          <div className="row">
            <label>
              Provedor
              <select value={form.providerId} onChange={(e) => set('providerId', Number(e.target.value))}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Modelo
              <div className="inline">
                <input
                  list="model-options"
                  value={form.model}
                  onChange={(e) => set('model', e.target.value)}
                  required
                  placeholder="ex.: gpt-4.1-mini, llama3.2"
                />
                <button type="button" onClick={() => void loadModels()} disabled={loadingModels}>
                  {loadingModels ? '…' : 'Listar'}
                </button>
              </div>
              <datalist id="model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>

          <label>
            Temperatura: {form.temperature.toFixed(1)}
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) => set('temperature', Number(e.target.value))}
            />
          </label>

          <label className="check" title="Armazena respostas idênticas em cache (TTL 24h). Ativo automaticamente para temperatura ≤ 0,3.">
            <input
              type="checkbox"
              checked={form.usarCache}
              onChange={(e) => set('usarCache', e.target.checked)}
            />
            Usar cache de respostas
          </label>

          <details>
            <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>Verificador de fontes</summary>
            <div className="field" style={{ gap: '0.5rem', display: 'flex', flexDirection: 'column' }}>
              <label className="check">
                <input type="checkbox" checked={form.verificarFontes} onChange={(e) => set('verificarFontes', e.target.checked)} />
                Verificar afirmações após cada resposta
              </label>
              {form.verificarFontes && (
                <>
                  <label>
                    Provedor do verificador
                    <select value={form.verificadorProviderId ?? ''} onChange={(e) => set('verificadorProviderId', Number(e.target.value) || null)}>
                      <option value="">— mesmo do agente —</option>
                      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Modelo do verificador
                    <input
                      value={form.verificadorModel ?? ''}
                      placeholder="ex: gpt-4o-mini"
                      onChange={(e) => set('verificadorModel', e.target.value || null)}
                    />
                  </label>
                </>
              )}
            </div>
          </details>

          {editing && delCfg && (
            <details>
              <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>Delegação</summary>
              <div className="field" style={{ gap: '0.5rem', display: 'flex', flexDirection: 'column' }}>
                <label className="check">
                  <input type="checkbox" checked={delCfg.podeDelegar} onChange={(e) => setDelCfg({ ...delCfg, podeDelegar: e.target.checked })} />
                  Pode delegar tarefas para outros bots
                </label>
                <label className="check">
                  <input type="checkbox" checked={delCfg.podeReceber} onChange={(e) => setDelCfg({ ...delCfg, podeReceber: e.target.checked })} />
                  Pode receber tarefas de outros bots
                </label>
                {delCfg.podeDelegar && (
                  <>
                    <div className="field">
                      <span className="muted small">Bots que pode chamar:</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 120, overflowY: 'auto' }}>
                        {agents.filter((a) => a.id !== selectedId).map((a) => (
                          <label key={a.id} className="check">
                            <input
                              type="checkbox"
                              checked={delCfg.destinosPermitidos.includes(a.id)}
                              onChange={(e) => setDelCfg({
                                ...delCfg,
                                destinosPermitidos: e.target.checked
                                  ? [...delCfg.destinosPermitidos, a.id]
                                  : delCfg.destinosPermitidos.filter((id) => id !== a.id)
                              })}
                            />
                            <span className="dot" style={{ background: a.color }} /> {a.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label>
                      Profundidade máxima: {delCfg.maxProfundidade}
                      <input type="range" min={1} max={10} value={delCfg.maxProfundidade} onChange={(e) => setDelCfg({ ...delCfg, maxProfundidade: Number(e.target.value) })} />
                    </label>
                    <label>
                      Delegações por resposta: {delCfg.maxPorResposta}
                      <input type="range" min={1} max={10} value={delCfg.maxPorResposta} onChange={(e) => setDelCfg({ ...delCfg, maxPorResposta: Number(e.target.value) })} />
                    </label>
                  </>
                )}
              </div>
            </details>
          )}

          {mcpServers.some((s) => s.tools.length > 0) && (
            <details>
              <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>Ferramentas MCP</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {mcpServers.filter((s) => s.tools.length > 0).map((s) => (
                  <div key={s.name}>
                    <strong className="small">{s.name}</strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.3rem' }}>
                      {s.tools.map((t) => {
                        const checked = form.mcpTools.some((r) => r.serverName === s.name && r.toolName === t.name)
                        const knownDescription = getMcpDescricaoPtBR(t.name, t.description)
                        const properties = t.inputSchema?.properties && typeof t.inputSchema.properties === 'object'
                          ? t.inputSchema.properties as Record<string, unknown>
                          : null
                        return (
                          <label key={t.name} className="check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...form.mcpTools, { serverName: s.name, toolName: t.name }]
                                  : form.mcpTools.filter((r) => !(r.serverName === s.name && r.toolName === t.name))
                                set('mcpTools', next)
                              }}
                            />
                            <span className="small">
                              <strong>{t.name}</strong> — <McpTranslatedDescription serverName={s.name} itemName={t.name} original={t.description} knownTranslation={knownDescription} translated={t.descriptionPtBr} translationStatus={t.translationStatus} />
                              {properties && <ul className="mg-list">{Object.entries(properties).map(([name, raw]) => {
                                const schema = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
                                const description = typeof schema.description === 'string' ? schema.description : ''
                                const translatedSchema = t.inputSchemaPtBr?.properties
                                const translatedProperty = translatedSchema && typeof translatedSchema === 'object' ? (translatedSchema as Record<string, unknown>)[name] : undefined
                                const translatedDescription = translatedProperty && typeof translatedProperty === 'object' && typeof (translatedProperty as Record<string, unknown>).description === 'string'
                                  ? (translatedProperty as Record<string, unknown>).description as string
                                  : undefined
                                return description ? <li key={name} className="small"><code>{name}</code> — <McpTranslatedDescription serverName={s.name} itemName={`${t.name}.${name}`} original={description} translated={translatedDescription} translationStatus={t.translationStatus} /></li> : null
                              })}</ul>}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {editing && (
            <section className="mcp-always-approved" aria-labelledby="mcp-always-approved-title">
              <div className="row-between">
                <strong id="mcp-always-approved-title">Ferramentas sempre aprovadas</strong>
                <span className="tag">{alwaysApproved.length}</span>
              </div>
              <p className="mcp-risk-warning" role="note">
                ⚠ Estas ferramentas podem ser executadas sem pedir confirmação. Remova permissões que não sejam necessárias.
              </p>
              {alwaysApproved.length === 0 ? (
                <p className="muted small">Nenhuma ferramenta configurada como sempre aprovada.</p>
              ) : (
                <ul className="mcp-always-approved-list">
                  {alwaysApproved.map((item) => (
                    <li key={`${item.serverName}::${item.toolName}`}>
                      <span><strong>{item.toolName}</strong> <span className="muted">@ {item.serverName}</span></span>
                      <button type="button" className="danger small" onClick={() => void removeAlwaysApproved(item)}>Remover</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div className="actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            {editing && (
              <>
                <button type="button" onClick={() => onOpenChat(selectedId)}>
                  Conversar
                </button>
                <button type="button" onClick={() => void duplicate(selectedId)}>
                  Duplicar
                </button>
                <button type="button" className="danger" onClick={() => void remove(selectedId)}>
                  Excluir
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
