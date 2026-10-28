import { describe, it, expect } from 'vitest'
import { DESKTOP_ONLY } from '../../src/main/webBridge'
import { channels as c } from '../../src/shared/ipc'

// Central de Acesso: os canais de acesso são DESKTOP_ONLY → bloqueados na web.
describe('Central de Acesso (isWeb)', () => {
  it('accessInfo é DESKTOP_ONLY (bloqueado na web)', () => {
    expect(DESKTOP_ONLY.has(c.accessInfo)).toBe(true)
  })

  it('accessDevices é DESKTOP_ONLY', () => {
    expect(DESKTOP_ONLY.has(c.accessDevices)).toBe(true)
  })

  it('accessNewToken é DESKTOP_ONLY', () => {
    expect(DESKTOP_ONLY.has(c.accessNewToken)).toBe(true)
  })

  it('accessDisconnect é DESKTOP_ONLY', () => {
    expect(DESKTOP_ONLY.has(c.accessDisconnect)).toBe(true)
  })

  it('accessRestartWeb é DESKTOP_ONLY', () => {
    expect(DESKTOP_ONLY.has(c.accessRestartWeb)).toBe(true)
  })

  it('agentsList NÃO é DESKTOP_ONLY (funciona na web)', () => {
    expect(DESKTOP_ONLY.has(c.agentsList)).toBe(false)
  })
})
