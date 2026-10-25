import { useCallback, useEffect, useState } from 'react'
import type { McpServerInfo, McpToolDef } from '@shared/mcp'
import type { McpServerConfig } from '@shared/mcp'
import { api, errorMessage } from '../api'
import { useToast } from '../toast'

const statusLabel: Record<string, string> = { connected: 'Conectado', connecting: 'Conectando…', error: 'Erro', off: 'Desligado' }
const statusClass: Record<string, string> = { connected: 'mcp-badge-ok', connecting: 'mcp-badge-wait', error: 'mcp-badge-err', off: 'mcp-badge-off' }

function emptyStdio() { return { transport: 'stdio' as const, command: '', args: [], env: {} } }
function emptyHttp() { return { transport: 'http' as const, url: '', headers: {} } }

interface FormState {
  name: string
  transport: 'stdio' | 'http'
  command: string
  argsText: string  // one arg per line
  envText: string   // KEY=VALUE per line
  url: string
  enabled: boolean
}

function formToConfig(f: FormState): McpServerConfig {
  if (f.transport === 'http') return { transport: 'http', url: f.url.trim(), headers: {} }
  const env: Record<string, string> = {}
  for (const line of f.envText.split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  return { transport: 'stdio', command: f.command.trim(), args: f.argsText.split('\n').map((a) => a.trim()).filter(Boolean), env }
}

function emptyForm(): FormState {
  return { name: '', transport: 'stdio', command: '', argsText: '', envText: '', url: '', enabled: true }
}

function serverToForm(s: McpServerInfo): FormState {
  const cfg = s.config
  if (cfg.transport === 'http') return { name: s.name, transport: 'http', command: '', argsText: '', envText: '', url: cfg.url, enabled: s.enabled }
  const envText = Object.entries(cfg.env).map(([k, v]) => `${k}=${v}`).join('\n')
  return { name: s.name, transport: 'stdio', command: cfg.command, argsText: cfg.args.join('\n'), envText, url: '', enabled: s.enabled }
}

interface ToolTestModalProps {
  server: McpServerInfo
  tool: McpToolDef
  onClose: () => void
}

function ToolTestModal({ server, tool, onClose }: ToolTestModalProps) {
  const toast = useToast()
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    let args: Record<string, unknown>
    try { args = JSON.parse(argsText) as Record<string, unknown> } catch { toast.error('JSON inválido'); return }
    setRunning(true); setResult(null)
    try {
      const r = await api.mcp.callTool(server.name, tool.name, args)
      setResult(`${r.isError ? '⚠ Erro' : '✓ OK'} · ${r.durationMs}ms\n\n${r.content}`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setRunning(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Testar: {tool.name}</strong>
          <button className="mg-x" onClick={onClose}>×</button>
        </div>
        <p className="small muted">{tool.description}</p>
        <label className="field-label">Argumentos (JSON)</label>
        <textarea className="code-area" value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={6} />
        <button onClick={() => void run()} disabled={running}>{running ? 'Executando…' : 'Executar'}</button>
        {result && <pre className="mcp-result">{result}</pre>}
      </div>
    </div>
  )
}

export function McpPage() {
  const toast = useToast()
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [editName, setEditName] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testModal, setTestModal] = useState<{ server: McpServerInfo; tool: McpToolDef } | null>(null)

  const reload = useCallback(async () => {
    try { setServers(await api.mcp.list()) } catch (e) { toast.error(errorMessage(e)) }
  }, [toast])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const unsub = api.mcp.onStatusChanged(() => void reload())
    return unsub
  }, [reload])

  function openAdd() { setForm(emptyForm()); setEditName(''); setModal('add') }
  function openEdit(s: McpServerInfo) { setForm(serverToForm(s)); setEditName(s.name); setModal('edit') }

  async function save() {
    if (!form.name.trim()) { toast.error('Informe o nome do servidor'); return }
    let config: McpServerConfig
    try { config = formToConfig(form) } catch (e) { toast.error(errorMessage(e)); return }
    setSaving(true)
    try {
      if (modal === 'add') setServers(await api.mcp.add(form.name.trim(), config, form.enabled))
      else setServers(await api.mcp.update(editName, config))
      setModal(null)
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }

  async function remove(name: string) {
    if (!confirm(`Remover servidor "${name}"?`)) return
    try { setServers(await api.mcp.remove(name)) } catch (e) { toast.error(errorMessage(e)) }
  }

  async function toggle(s: McpServerInfo) {
    try { setServers(await api.mcp.toggle(s.name, !s.enabled)) } catch (e) { toast.error(errorMessage(e)) }
  }

  async function restart(name: string) {
    try { await api.mcp.restart(name); void reload() } catch (e) { toast.error(errorMessage(e)) }
  }

  async function importConfig() {
    try { setServers(await api.mcp.importConfig()) } catch (e) { toast.error(errorMessage(e)) }
  }

  const f = form

  return (
    <div className="page scroll">
      <div className="pane-header">
        <h2>Servidores MCP</h2>
        <div className="row-gap">
          <button onClick={openAdd}>+ Adicionar</button>
          <button onClick={() => void importConfig()}>Importar mcp.json</button>
        </div>
      </div>

      {servers.length === 0 && <p className="muted pad">Nenhum servidor configurado.</p>}

      {servers.map((s) => (
        <div key={s.name} className="mcp-server-card">
          <div className="mcp-server-row">
            <span className={`mcp-badge ${statusClass[s.status] ?? ''}`}>{statusLabel[s.status] ?? s.status}</span>
            <strong>{s.name}</strong>
            <span className="small muted">{s.config.transport === 'stdio' ? s.config.command : s.config.url}</span>
            <div className="row-gap mcp-actions">
              <button onClick={() => toggle(s)}>{s.enabled ? 'Desligar' : 'Ligar'}</button>
              {s.status === 'connected' && <button onClick={() => void restart(s.name)}>Reiniciar</button>}
              <button onClick={() => openEdit(s)}>Editar</button>
              <button onClick={() => void remove(s.name)} className="btn-danger">Remover</button>
              <button onClick={() => setExpanded(expanded === s.name ? null : s.name)}>
                {expanded === s.name ? '▲' : '▼'}
              </button>
            </div>
          </div>
          {s.error && <p className="mcp-error small">{s.error}</p>}
          {expanded === s.name && (
            <div className="mcp-caps">
              <strong className="small">Ferramentas ({s.tools.length})</strong>
              {s.tools.length === 0 && <span className="small muted"> — nenhuma</span>}
              <ul className="mg-list">
                {s.tools.map((t) => (
                  <li key={t.name} className="mcp-tool-row">
                    <span className="small"><strong>{t.name}</strong> — {t.description}</span>
                    <button className="small" onClick={() => setTestModal({ server: s, tool: t })}>Testar</button>
                  </li>
                ))}
              </ul>
              {s.resources.length > 0 && (
                <>
                  <strong className="small">Recursos ({s.resources.length})</strong>
                  <ul className="mg-list">
                    {s.resources.map((r) => <li key={r.uri} className="small">{r.name} — <code>{r.uri}</code></li>)}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {(modal === 'add' || modal === 'edit') && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{modal === 'add' ? 'Adicionar servidor MCP' : `Editar: ${editName}`}</strong>
              <button className="mg-x" onClick={() => setModal(null)}>×</button>
            </div>

            {modal === 'add' && (
              <label className="field-label">Nome
                <input value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })} placeholder="meu-servidor" />
              </label>
            )}

            <label className="field-label">Tipo
              <select value={f.transport} onChange={(e) => setForm({ ...f, transport: e.target.value as 'stdio' | 'http' })}>
                <option value="stdio">stdio (processo local)</option>
                <option value="http">HTTP (URL remota)</option>
              </select>
            </label>

            {f.transport === 'stdio' ? (
              <>
                <label className="field-label">Comando
                  <input value={f.command} onChange={(e) => setForm({ ...f, command: e.target.value })} placeholder="npx" />
                </label>
                <label className="field-label">Argumentos (um por linha)
                  <textarea value={f.argsText} onChange={(e) => setForm({ ...f, argsText: e.target.value })} rows={3} placeholder={`-y\n@modelcontextprotocol/server-filesystem\n/pasta`} />
                </label>
                <label className="field-label">Variáveis de ambiente (KEY=VALOR, um por linha)
                  <textarea value={f.envText} onChange={(e) => setForm({ ...f, envText: e.target.value })} rows={3} placeholder="API_KEY=***" />
                </label>
              </>
            ) : (
              <label className="field-label">URL
                <input value={f.url} onChange={(e) => setForm({ ...f, url: e.target.value })} placeholder="https://meu-servidor.com/mcp" />
              </label>
            )}

            {modal === 'add' && (
              <label className="check">
                <input type="checkbox" checked={f.enabled} onChange={(e) => setForm({ ...f, enabled: e.target.checked })} />
                Conectar ao salvar
              </label>
            )}

            <div className="modal-footer">
              <button onClick={() => setModal(null)}>Cancelar</button>
              <button onClick={() => void save()} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {testModal && (
        <ToolTestModal server={testModal.server} tool={testModal.tool} onClose={() => setTestModal(null)} />
      )}
    </div>
  )
}
