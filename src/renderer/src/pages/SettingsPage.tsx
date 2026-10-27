import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  defaultBaseUrls,
  providerKindLabels,
  providerKinds,
  type CacheStats,
  type Provider,
  type ProviderInput,
  type ProviderKind,
  type Settings,
  type AppVersion,
  type UpdateCheck,
  type UpdateProgress
} from '@shared/types'
import { api } from '../api'
import { useToast } from '../toast'

interface Props {
  providers: Provider[]
  onProvidersChanged: () => Promise<void>
}

const emptyProvider = (kind: ProviderKind = 'openai'): ProviderInput => ({
  kind,
  name: providerKindLabels[kind],
  baseUrl: defaultBaseUrls[kind],
  apiKey: undefined
})

function UpdateSection() {
  const [ver, setVer] = useState<AppVersion | null>(null)
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<UpdateProgress | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [started, setStarted] = useState(false)

  useEffect(() => {
    void api.update.version().then(setVer)
    // abriu a tela com uma atualização já em andamento (ex.: iniciada pelo celular)
    void api.update.status().then((s) => {
      if (s.running || s.error) { setStarted(true); setLines(s.log.slice(-30)); setProg({ etapa: s.failedEtapa ?? s.etapa, percent: s.percent, log: '', error: s.error }) }
    })
    return api.update.onProgress((p) => {
      setStarted(true)
      setProg(p)
      if (p.log) setLines((l) => [...l.slice(-29), p.log])
    })
  }, [])

  async function search() {
    setBusy(true)
    try { setCheck(await api.update.check()) } catch (e) { setCheck({ behind: 0, commits: [], error: String(e) }) }
    setBusy(false)
  }
  async function apply() {
    setLines([])
    setProg({ etapa: 'Iniciando', percent: 0, log: '', error: null })
    setStarted(true)
    await api.update.apply()
  }

  const failed = !!prog?.error
  const running = started && !failed && (prog?.percent ?? 0) < 100

  return (
    <section className="card">
      <h2>Atualização</h2>
      <p className="muted small mono">{ver ? `v${ver.version} · ${ver.commit}` : '…'}</p>
      <div className="actions">
        <button disabled={busy || running} onClick={() => void search()}>Buscar atualização</button>
        {check && check.behind > 0 && !started && <button onClick={() => void apply()}>Atualizar agora</button>}
        {failed && <button onClick={() => void apply()}>Tentar de novo</button>}
      </div>
      {check?.error && <p className="small" style={{ color: '#c00' }}>{check.error}</p>}
      {check && !check.error && (check.behind === 0
        ? <p className="muted small">Já está atualizado.</p>
        : <p className="small">{check.behind} {check.behind === 1 ? 'commit novo' : 'commits novos'}:<br />{check.commits.join(' · ')}</p>)}
      {prog && (
        <>
          <p className="small" style={{ margin: '8px 0 4px', color: failed ? '#c00' : undefined }}>
            {failed ? `Falhou em “${prog.etapa}”` : prog.etapa} — {prog.percent}%
          </p>
          <div style={{ height: 10, background: '#ddd', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${prog.percent}%`, height: '100%', background: failed ? '#d33' : '#2d6cdf', transition: 'width .3s' }} />
          </div>
          {failed && <p className="small" style={{ color: '#c00' }}>{prog.error}</p>}
          <details>
            <summary className="small">Log</summary>
            <div className="small mono" style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </details>
        </>
      )}
    </section>
  )
}

export function SettingsPage({ providers, onProvidersChanged }: Props) {
  const toast = useToast()
  const [editingId, setEditingId] = useState<number | 'new' | null>(providers.length === 0 ? 'new' : null)
  const [form, setForm] = useState<ProviderInput>(emptyProvider())
  const [removeKey, setRemoveKey] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [localIps, setLocalIps] = useState<string[]>([])
  const [showToken, setShowToken] = useState(false)
  const [qr, setQr] = useState('')
  const link = localIps[0] ? `http://${localIps[0]}:3111` : ''
  useEffect(() => {
    if (link) void QRCode.toDataURL(link, { margin: 1 }).then(setQr)
    else setQr('')
  }, [link])
  const [dataDir, setDataDir] = useState('')
  const [perfStats, setPerfStats] = useState<CacheStats | null>(null)
  const [claudeModel, setClaudeModel] = useState('')

  useEffect(() => {
    Promise.all([api.settings.get(), api.settings.dataDir(), api.perf.stats(), api.settings.localIps()])
      .then(([s, dir, stats, ips]) => {
        setLocalIps(ips)
        setSettings(s)
        setClaudeModel(s.claudeCodeModel)
        setDataDir(dir)
        setPerfStats(stats)
      })
      .catch(toast.error)
  }, [toast.error])

  function edit(p: Provider | 'new') {
    setRemoveKey(false)
    if (p === 'new') {
      setEditingId('new')
      setForm(emptyProvider())
    } else {
      setEditingId(p.id)
      // apiKey undefined = manter a chave já salva
      setForm({ kind: p.kind, name: p.name, baseUrl: p.baseUrl, apiKey: undefined })
    }
  }

  function changeKind(kind: ProviderKind) {
    setForm((f) => ({
      ...f,
      kind,
      name: Object.values(providerKindLabels).includes(f.name) || !f.name ? providerKindLabels[kind] : f.name,
      baseUrl: Object.values(defaultBaseUrls).includes(f.baseUrl) || !f.baseUrl ? defaultBaseUrls[kind] : f.baseUrl
    }))
  }

  async function saveProvider() {
    try {
      // Ollama não usa chave: trocar para ele descarta a que existir.
      const apiKey = removeKey || form.kind === 'ollama' ? '' : form.apiKey
      const input = { ...form, apiKey }
      const saved =
        editingId === 'new' ? await api.providers.create(input) : await api.providers.update(editingId!, input)
      await onProvidersChanged()
      setEditingId(null)
      toast.info(`Provedor "${saved.name}" salvo`)
    } catch (err) {
      toast.error(err)
    }
  }

  async function testProvider(id: number) {
    try {
      const models = await api.providers.listModels(id)
      toast.info(`Conexão ok: ${models.length} modelo(s) disponível(is)`)
    } catch (err) {
      toast.error(err)
    }
  }

  async function removeProvider(id: number) {
    if (!confirm('Excluir este provedor e sua chave?')) return
    try {
      await api.providers.remove(id)
      await onProvidersChanged()
      setEditingId(null)
    } catch (err) {
      toast.error(err)
    }
  }

  async function updateSettings(patch: Partial<Settings>) {
    if (!settings) return
    try {
      setSettings(await api.settings.update({ ...settings, ...patch }))
    } catch (err) {
      toast.error(err)
    }
  }

  async function backup() {
    try {
      const file = await api.settings.backup()
      if (file) toast.info(`Backup salvo em ${file}`)
    } catch (err) {
      toast.error(err)
    }
  }

  const editingProvider = typeof editingId === 'number' ? providers.find((p) => p.id === editingId) : undefined

  return (
    <div className="page scroll">
      <section className="card">
        <div className="pane-header">
          <h2>Provedores de modelo</h2>
          <button onClick={() => edit('new')}>+ Adicionar</button>
        </div>

        {providers.length === 0 && editingId === null && <p className="muted">Nenhum provedor cadastrado.</p>}

        <ul className="provider-list">
          {providers.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.name}</strong> <span className="tag">{providerKindLabels[p.kind]}</span>
                <div className="muted small">
                  {p.baseUrl} · {p.kind === 'ollama' ? 'sem chave' : p.hasKey ? 'chave salva' : 'sem chave'}
                </div>
              </div>
              <div className="actions">
                <button onClick={() => void testProvider(p.id)}>Testar</button>
                <button onClick={() => edit(p)}>Editar</button>
                <button className="danger" onClick={() => void removeProvider(p.id)}>
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>

        {editingId !== null && (
          <form
            className="form sub"
            onSubmit={(e) => {
              e.preventDefault()
              void saveProvider()
            }}
          >
            <h3>{editingId === 'new' ? 'Novo provedor' : 'Editar provedor'}</h3>
            <div className="row">
              <label>
                Tipo
                <select value={form.kind} onChange={(e) => changeKind(e.target.value as ProviderKind)}>
                  {providerKinds.map((k) => (
                    <option key={k} value={k}>
                      {providerKindLabels[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grow">
                Nome
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </label>
            </div>
            <label>
              URL base
              <input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                required
                className="mono"
              />
            </label>
            {form.kind !== 'ollama' && (
              <label>
                Chave de API
                <input
                  type="password"
                  autoComplete="off"
                  value={form.apiKey ?? ''}
                  // vazio = não mexer na chave; remover é uma ação explícita
                  onChange={(e) => {
                    setRemoveKey(false)
                    setForm({ ...form, apiKey: e.target.value || undefined })
                  }}
                  placeholder={
                    removeKey
                      ? 'a chave será removida ao salvar'
                      : editingProvider?.hasKey
                        ? '•••••••• (deixe vazio para manter)'
                        : 'cole a chave aqui'
                  }
                />
                <span className="muted small">
                  Guardada cifrada pelo Windows neste computador. Nunca é enviada para a interface.
                </span>
              </label>
            )}
            <div className="actions">
              <button type="submit" className="primary">
                Salvar
              </button>
              {editingProvider?.hasKey && form.kind !== 'ollama' && (
                <button
                  type="button"
                  onClick={() => {
                    setRemoveKey(true)
                    setForm({ ...form, apiKey: undefined })
                  }}
                  title="Remove a chave ao salvar"
                >
                  Remover chave
                </button>
              )}
              <button type="button" onClick={() => setEditingId(null)}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </section>

      {settings && (
        <section className="card">
          <h2>Preferências</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.minimizeToTray}
              onChange={(e) => void updateSettings({ minimizeToTray: e.target.checked })}
            />
            Ao fechar a janela, manter na bandeja (as rotinas continuam rodando)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.notifyOnRun}
              onChange={(e) => void updateSettings({ notifyOnRun: e.target.checked })}
            />
            Notificar quando uma rotina ou fluxo terminar
          </label>
          <label>
            Manter histórico (dias)
            <input
              type="number"
              min={1}
              max={3650}
              value={settings.retentionDays}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (v >= 1 && v <= 3650) void updateSettings({ retentionDays: v })
              }}
              style={{ width: '80px', marginLeft: '8px' }}
            />
          </label>
        </section>
      )}

      {settings && (
        <section className="card">
          <h2>Claude Code local</h2>
          <label>
            Modelo do Claude Code local
            <input
              className="mono"
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              onBlur={() => {
                const v = claudeModel.trim()
                if (v && v !== settings.claudeCodeModel) void updateSettings({ claudeCodeModel: v })
              }}
              placeholder="qwen2.5:0.5b"
            />
            <span className="muted small">Modelo do Ollama usado pela ferramenta claude_code dos agentes.</span>
          </label>
          <label>
            Tempo limite (minutos)
            <input
              type="number"
              min={1}
              max={120}
              value={settings.claudeCodeTimeoutMin}
              onChange={(e) => {
                const v = parseInt(e.target.value)
                if (v >= 1 && v <= 120) void updateSettings({ claudeCodeTimeoutMin: v })
              }}
              style={{ width: '80px', marginLeft: '8px' }}
            />
          </label>
          <div className="actions">
            <button onClick={async () => {
              try {
                toast.info(`Ollama ok (versão ${await api.settings.testOllama()})`)
              } catch (err) { toast.error(err) }
            }}>Testar Ollama</button>
          </div>
        </section>
      )}

      {perfStats && (
        <section className="card">
          <h2>Desempenho</h2>
          <div className="muted small" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem', marginBottom: '0.75rem' }}>
            <span>Banco de dados: <strong>{perfStats.dbSizeMb} MB</strong></span>
            <span>Entradas em cache: <strong>{perfStats.cacheRows}</strong></span>
            <span>Acertos de cache: <strong>{perfStats.cacheHits}</strong></span>
            <span>Tokens economizados: <strong>{perfStats.tokensSaved.toLocaleString()}</strong></span>
            {perfStats.oldestEntry && <span style={{ gridColumn: '1 / -1' }}>Entrada mais antiga: <strong>{new Date(perfStats.oldestEntry).toLocaleDateString('pt-BR')}</strong></span>}
          </div>
          <div className="actions">
            <button onClick={async () => {
              try {
                await api.perf.clearCache()
                setPerfStats(await api.perf.stats())
                toast.info('Cache limpo')
              } catch (err) { toast.error(err) }
            }}>Limpar cache</button>
            <button onClick={async () => {
              try {
                await api.perf.optimize()
                setPerfStats(await api.perf.stats())
                toast.info('Banco otimizado (VACUUM)')
              } catch (err) { toast.error(err) }
            }}>Otimizar banco</button>
          </div>
        </section>
      )}

      <UpdateSection />

      <section className="card">
        <h2>Dados</h2>
        <p className="muted small mono">{dataDir}</p>
        <div className="actions">
          <button onClick={() => void api.settings.openDataDir()}>Abrir pasta</button>
          <button onClick={() => void backup()}>Fazer backup do banco</button>
        </div>
      </section>

      {settings?.apiToken && (
        <section className="card">
          <h2>Acesso pelo celular</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.apiEnabled}
              onChange={(e) => void updateSettings({ apiEnabled: e.target.checked })}
            />
            Permitir acesso pelo celular (app ou navegador, porta 3111)
          </label>
          {settings.apiEnabled && (
            <>
              <p className="muted small">
                Endereço: {localIps.length > 0 ? localIps.map((ip) => `http://${ip}:3111`).join(' · ') : 'nenhuma rede encontrada'}
              </p>
              {qr && <img src={qr} alt="QR do endereço" width={160} height={160} />}
              <p className="muted small">Token do app Android. Nunca compartilhe.</p>
              <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
                <input readOnly value={showToken ? settings.apiToken : '•'.repeat(24)} className="mono" style={{ flex: 1, fontSize: 12 }} />
                <button onClick={() => setShowToken((v) => !v)}>{showToken ? 'Ocultar' : 'Mostrar'}</button>
                <button onClick={() => void navigator.clipboard.writeText(settings.apiToken)}>Copiar</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
