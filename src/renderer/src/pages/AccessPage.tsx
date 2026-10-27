import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { AccessDevice, AccessInfo, Settings } from '@shared/types'
import { api } from '../api'
import { useToast } from '../toast'
import type { Page } from '../App'
import { UpdateSection } from './SettingsPage'

const isWeb = (window as unknown as { pilotosWeb?: boolean }).pilotosWeb === true
const PC_ONLY = 'Disponível só no programa do PC'

const fmtUptime = (s: number): string => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}min` : m > 0 ? `${m}min ${s % 60}s` : `${s}s`
}

const shortcuts: { label: string; page: Page }[] = [
  { label: 'Bots', page: 'agents' },
  { label: 'Conversas', page: 'chat' },
  { label: 'Execuções', page: 'runs' },
  { label: 'Configurações', page: 'settings' }
]

export function AccessPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const toast = useToast()
  const [info, setInfo] = useState<AccessInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ips, setIps] = useState<string[]>([])
  const [devices, setDevices] = useState<AccessDevice[]>([])
  const [served, setServed] = useState<string>('')
  const [showToken, setShowToken] = useState(false)
  const [qr, setQr] = useState<{ url: string; img: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [i, d] = await Promise.all([api.access.info(), api.access.devices()])
      setInfo(i)
      setDevices(d)
      // na web, pergunta à própria URL o que ela serve; no PC, o servidor roda neste mesmo processo
      setServed(isWeb ? ((await (await fetch('/api/version', { cache: 'no-store' })).json()) as { commit: string }).commit : i.commit)
    } catch (e) {
      toast.error(e)
    }
  }, [toast])

  useEffect(() => {
    void api.settings.get().then(setSettings)
    void api.settings.localIps().then(setIps)
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  const copy = (text: string): void => { void navigator.clipboard.writeText(text).then(() => toast.info('Copiado')) }
  const url = (ip: string, path = ''): string => `http://${ip}:${info?.port ?? 3111}${path}`
  const ip0 = ips[0]
  const stale = !!info && !!served && served !== info.head

  async function toggleServer(on: boolean) {
    if (!settings) return
    try { setSettings(await api.settings.update({ ...settings, apiEnabled: on })); await refresh() } catch (e) { toast.error(e) }
  }
  async function restartWeb() {
    try { await api.access.restartWeb(); toast.info('Servidor web reiniciado'); setTimeout(() => void refresh(), 1500) } catch (e) { toast.error(e) }
  }
  async function newToken() {
    if (!confirm('Gerar novo token? O atual deixa de valer e todos os navegadores conectados serão desconectados.')) return
    try { await api.access.newToken(); setSettings(await api.settings.get()); await refresh(); toast.info('Novo token gerado') } catch (e) { toast.error(e) }
  }
  async function showQr(u: string) {
    setQr(qr?.url === u ? null : { url: u, img: await QRCode.toDataURL(u, { margin: 1 }) })
  }

  const link = (u: string) => (
    <div key={u} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0' }}>
      <span className="mono small" style={{ flex: 1, minWidth: 180 }}>{u}</span>
      <button onClick={() => window.open(u, '_blank')}>Abrir no navegador</button>
      <button onClick={() => copy(u)}>Copiar</button>
      <button onClick={() => void showQr(u)}>QR code</button>
    </div>
  )

  return (
    <div className="page">
      <h1>Central de acesso</h1>
      {isWeb && <p className="muted small">{PC_ONLY}: atualizar o programa, gerar token, desconectar dispositivos e reiniciar a web.</p>}

      <UpdateSection
        readOnly={isWeb}
        info={info && (
          <div className="small mono">
            <div>Versão {info.version} · commit em execução {info.commit} · código atual (HEAD) {info.head}</div>
            <div>Pasta: {info.runDir} · build: {info.buildDate ? new Date(info.buildDate).toLocaleString('pt-BR') : '—'}</div>
          </div>
        )}
      />

      <section className="card">
        <h2>Acesso pela URL (web)</h2>
        <label className="check">
          <input type="checkbox" checked={settings?.apiEnabled ?? false} disabled={isWeb || !settings} onChange={(e) => void toggleServer(e.target.checked)} />
          Servidor web {info?.listening ? 'ligado' : 'desligado'}
        </label>
        <p className="muted small">Porta {info?.port ?? '—'} · no ar há {info?.listening ? fmtUptime(info.uptimeSec) : '—'} · a URL serve o commit {served || '—'}</p>
        {stale && (
          <div style={{ background: '#fff3cd', color: '#664d03', padding: 10, borderRadius: 8, margin: '8px 0' }}>
            <b>Web desatualizada</b>: a URL serve {served}, mas o código do programa está em {info?.head}.
            <div className="small">Recarregar web reinicia o servidor e manda os navegadores recarregarem. Para trazer o código novo, use “Atualizar agora”.</div>
            <div className="actions"><button disabled={isWeb} onClick={() => void restartWeb()}>Recarregar web</button>{isWeb && <span className="small"> {PC_ONLY}</span>}</div>
          </div>
        )}
        {!stale && !isWeb && <div className="actions"><button onClick={() => void restartWeb()}>Recarregar web</button></div>}
        {ips.length === 0 && <p className="muted small">Nenhuma rede encontrada.</p>}
        {ips.map((ip) => (
          <div key={ip}>
            <div className="small muted" style={{ marginTop: 8 }}>Completo (interface igual ao programa)</div>
            {link(url(ip))}
            <div className="small muted">Simples (/lite)</div>
            {link(url(ip, '/lite'))}
          </div>
        ))}
        {qr && <div><img src={qr.img} alt={`QR de ${qr.url}`} width={160} height={160} /><p className="small mono">{qr.url}</p></div>}
      </section>

      <section className="card">
        <h2>Token e segurança</h2>
        <p className="small" style={{ color: '#b00' }}><b>Não abra a porta 3111 no roteador.</b></p>
        {isWeb ? <p className="muted small">{PC_ONLY}</p> : (
          <>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input readOnly className="mono" style={{ flex: 1, fontSize: 12 }} value={showToken ? settings?.apiToken ?? '' : '•'.repeat(24)} />
              <button onClick={() => setShowToken((v) => !v)}>{showToken ? 'Ocultar' : 'Mostrar'}</button>
              <button onClick={() => copy(settings?.apiToken ?? '')}>Copiar</button>
            </div>
            <div className="actions"><button onClick={() => void newToken()}>Gerar novo token</button></div>
          </>
        )}
        <h3>Dispositivos conectados agora</h3>
        {devices.length === 0 && <p className="muted small">Nenhum.</p>}
        {devices.map((d) => (
          <div key={d.ip + d.ua} className="row" style={{ gap: 8, alignItems: 'center', margin: '4px 0' }}>
            <span className="small mono" style={{ flex: 1 }}>{d.ip} · {d.ua} · {new Date(d.last).toLocaleTimeString('pt-BR')}</span>
            <button disabled={isWeb} title={isWeb ? PC_ONLY : undefined} onClick={() => void api.access.disconnect(d.ip).then(refresh).catch(toast.error)}>Desconectar</button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Atalhos de funções</h2>
        {shortcuts.map((s) => (
          <div key={s.page} className="row" style={{ gap: 8, alignItems: 'center', margin: '4px 0', flexWrap: 'wrap' }}>
            <button onClick={() => onNavigate(s.page)}>{s.label}</button>
            <span className="mono small">{ip0 ? url(ip0, `/#/${s.page}`) : `/#/${s.page}`}</span>
            {ip0 && <button onClick={() => copy(url(ip0, `/#/${s.page}`))}>Copiar link</button>}
          </div>
        ))}
      </section>
    </div>
  )
}
