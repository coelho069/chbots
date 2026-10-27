// Ponte para o navegador: os mesmos handlers do ipcMain ficam acessíveis via HTTP e os eventos via SSE.
import type { ServerResponse } from 'node:http'
import { channels as c } from '@shared/ipc'

type Handler = (...args: unknown[]) => unknown

export const webHandlers = new Map<string, Handler>()
const clients = new Set<ServerResponse>()

// Funções que abrem diálogos/pastas no desktop: não fazem sentido para quem está no navegador.
export const DESKTOP_ONLY = new Set<string>([c.promptsSaveMd, c.mcpImport, c.settingsOpenDataDir, c.settingsBackup, c.appAskUnsaved])

export function broadcast(channel: string, payload?: unknown): void {
  if (clients.size === 0) return
  const msg = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const c of clients) c.write(msg)
}

export function addEventClient(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write(': ok\n\n')
  clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  res.on('close', () => { clearInterval(ping); clients.delete(res) })
}
