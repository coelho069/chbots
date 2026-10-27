// No navegador não há preload: monta window.pilotos com fetch (/api/ipc) e SSE (/api/events), autenticando com Bearer.
import { events } from '@shared/ipc'
import { buildApi, type Invoke, type Subscribe } from '@shared/apiFactory'

const TK = 'tk'
const UPD = 'updated'
const store = (op: () => string | null | void): string => { try { return (op() as string) ?? '' } catch { return '' } }
const token = (): string => store(() => localStorage.getItem(TK))

async function check(t: string): Promise<boolean> {
  try { return (await fetch('/api/agents', { headers: { Authorization: 'Bearer ' + t } })).ok } catch { return false }
}

function askToken(): Promise<string> {
  return new Promise((resolve) => {
    const root = document.getElementById('root')!
    const box = document.createElement('div')
    box.style.cssText = 'max-width:360px;margin:20vh auto;padding:16px;font:16px system-ui'
    const h = document.createElement('h2'); h.textContent = 'CH BOTS'
    const i = document.createElement('input'); i.type = 'password'; i.placeholder = 'Cole o token'; i.style.cssText = 'width:100%;box-sizing:border-box;padding:10px;margin:8px 0'
    const e = document.createElement('p'); e.style.color = '#c00'
    const b = document.createElement('button'); b.textContent = 'Entrar'; b.style.padding = '10px'
    b.onclick = async () => {
      const t = i.value.trim()
      if (await check(t)) { store(() => localStorage.setItem(TK, t)); root.replaceChildren(); resolve(t) } else e.textContent = 'Token inválido'
    }
    box.append(h, i, e, b); root.replaceChildren(box)
  })
}

async function boot(): Promise<void> {
  let tk = token()
  if (!(await check(tk))) tk = await askToken()
  const auth = (): Record<string, string> => ({ Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' })

  const invoke: Invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const r = await fetch('/api/ipc', { method: 'POST', headers: auth(), body: JSON.stringify({ channel, args }) })
    if (r.status === 401) { store(() => localStorage.removeItem(TK)); location.reload() }
    const j = (await r.json().catch(() => ({}))) as { result?: T; error?: string }
    if (!r.ok) throw new Error((j.error ?? String(r.status)).replace(/^Error: /, ''))
    return j.result as T
  }

  const listeners = new Map<string, Set<(p: unknown) => void>>()
  async function listen(): Promise<void> {
    try {
      const r = await fetch('/api/events', { headers: auth() })
      const rd = r.body!.getReader(), dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await rd.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() ?? ''
        for (const p of parts) {
          if (!p.startsWith('data: ')) continue
          const ev = JSON.parse(p.slice(6)) as { channel: string; payload: unknown }
          listeners.get(ev.channel)?.forEach((l) => l(ev.payload))
        }
      }
    } catch { /* cai no reconnect */ }
    setTimeout(() => void listen(), 3000)
  }
  void listen()

  const subscribe: Subscribe = <T>(channel: string, listener: (payload: T) => void) => {
    const set = listeners.get(channel) ?? new Set()
    listeners.set(channel, set)
    set.add(listener as (p: unknown) => void)
    return () => { set.delete(listener as (p: unknown) => void) }
  }

  const api = buildApi(invoke, subscribe)
  // Diálogo nativo vira confirm(); 'save' não existe no navegador.
  api.app.askUnsaved = async () => (confirm('Há alterações não salvas. Descartar?') ? 'discard' : 'cancel')
  window.pilotos = api
  ;(window as unknown as { pilotosWeb: boolean }).pilotosWeb = true
  // "Recarregar web" no PC: dá tempo do servidor voltar antes de recarregar
  subscribe(events.webReload, () => { setTimeout(() => location.reload(), 3000) })
  watchVersion()
  announceUpdate()
}

// Depois do reload por versão nova: aviso rápido na página do celular.
function announceUpdate(): void {
  const commit = store(() => localStorage.getItem(UPD))
  if (!commit) return
  store(() => localStorage.removeItem(UPD))
  const b = document.createElement('div')
  b.textContent = 'Atualizado para commit ' + commit
  b.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9999;padding:12px;border-radius:8px;background:#1a7f37;color:#fff;font:15px system-ui'
  b.onclick = () => b.remove()
  document.body.appendChild(b)
  setTimeout(() => b.remove(), 8000)
}

// Rodapé com a versão e recarga automática quando o servidor sobe uma versão nova (após "Atualizar agora").
function watchVersion(): void {
  const foot = document.createElement('div')
  foot.style.cssText = 'position:fixed;right:6px;bottom:2px;font:11px monospace;opacity:.6;pointer-events:none'
  document.body.appendChild(foot)
  let cur = ''
  const tick = async (): Promise<void> => {
    try {
      const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()) as { version: string; commit: string }
      const id = v.version + ' · ' + v.commit
      if (cur && cur !== id) { store(() => localStorage.setItem(UPD, v.commit)); location.reload(); return }
      cur = id; foot.textContent = 'v' + id
    } catch { /* servidor reiniciando: tenta de novo */ }
  }
  void tick()
  setInterval(() => void tick(), 30000)
}

// No Electron o preload já criou window.pilotos; no navegador, main.tsx só renderiza depois disto.
// Marca pilotosWeb sincronamente: App.tsx lê isWeb no momento em que o módulo é avaliado,
// antes de ready.then() disparar. Como main.tsx importa webShim antes de App, esta linha
// garante que isWeb === true quando App.tsx for parseado pelo bundler.
if (!window.pilotos) (window as unknown as { pilotosWeb: boolean }).pilotosWeb = true
export const ready: Promise<void> = window.pilotos ? Promise.resolve() : boot()
