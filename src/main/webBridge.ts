// Ponte para o navegador: os mesmos handlers do ipcMain ficam acessíveis via HTTP e os eventos via SSE.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { channels as c } from '@shared/ipc'

type Handler = (...args: unknown[]) => unknown

export const webHandlers = new Map<string, Handler>()
const clients = new Set<ServerResponse>()

// Funções que abrem diálogos/pastas no desktop ou mexem em segurança/atualização: não valem para quem está no navegador.
export const DESKTOP_ONLY = new Set<string>([
  c.promptsSaveMd, c.mcpImport, c.settingsOpenDataDir, c.settingsBackup, c.appAskUnsaved,
  c.updateApply, c.accessNewToken, c.accessDisconnect, c.accessRestartWeb,
  // Block all access channels on the web
  c.accessInfo, c.accessDevices
])

export function broadcast(channel: string, payload?: unknown): void {
  if (clients.size === 0) return
  const msg = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const cl of clients) cl.write(msg)
}

// ---- Dispositivos conectados (o token é um só, então identificamos por IP + navegador) ----
export interface Device { ip: string; ua: string; last: number }
const devices = new Map<string, Device>()
const blocked = new Set<string>()
const ONLINE_MS = 2 * 60 * 1000

export const clientIp = (s: { remoteAddress?: string } | null): string => (s?.remoteAddress ?? '').replace(/^::ffff:/, '')
export const isBlocked = (req: IncomingMessage): boolean => blocked.has(clientIp(req.socket))

function label(ua: string): string {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '?'
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  return `${br} · ${os}`
}

export function touchDevice(req: IncomingMessage): void {
  const ip = clientIp(req.socket), ua = label(String(req.headers['user-agent'] ?? ''))
  devices.set(ip + ua, { ip, ua, last: Date.now() })
}

export const listDevices = (): Device[] => [...devices.values()].filter((d) => Date.now() - d.last < ONLINE_MS).sort((a, b) => b.last - a.last)

function dropClients(match: (res: ServerResponse) => boolean): void {
  for (const r of [...clients]) if (match(r)) { clients.delete(r); r.end() }
}

// Bloqueia o IP até gerar novo token ou reiniciar o app (o token é compartilhado, não dá para revogar só um navegador).
export function disconnectIp(ip: string): void {
  blocked.add(ip)
  for (const [k, d] of devices) if (d.ip === ip) devices.delete(k)
  dropClients((r) => clientIp(r.socket) === ip)
}

export function resetClients(): void {
  blocked.clear()
  devices.clear()
  dropClients(() => true)
}

export function addEventClient(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write(': ok\n\n')
  clients.add(res)
  touchDevice(req)
  const ping = setInterval(() => { res.write(': ping\n\n'); touchDevice(req) }, 25000)
  res.on('close', () => { clearInterval(ping); clients.delete(res) })
}
