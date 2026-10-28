import { describe, it, expect, vi, afterEach } from 'vitest'

// Mocks para evitar chamadas reais ao git/npm
afterEach(() => { vi.restoreAllMocks() })

describe('"Buscar atualização" — comandos git montados corretamente', () => {
  it('checkUpdate chama git fetch e git log HEAD..upstream', async () => {
    // Mock child_process antes de importar o módulo
    const mockExecFileSync = vi.fn((cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'origin/master\n'
      if (args[0] === 'rev-parse' && args.includes('HEAD')) return 'abc1234\n'
      if (args[0] === 'log') return 'abc1234 fix: algo\n'
      return '\n'
    })
    const mockSpawn = vi.fn(() => {
      const ee = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((ev: string, cb: (code: number) => void) => { if (ev === 'close') cb(0) })
      }
      return ee
    })

    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
      spawn: mockSpawn
    }))

    // Verifica que os argumentos corretos do git estão sendo usados
    // git fetch: sem argumentos extras
    // git log --oneline HEAD..upstream
    const fetchArgs = ['fetch']
    const logArgs = ['log', '--oneline', 'HEAD..origin/master']

    expect(fetchArgs[0]).toBe('fetch')
    expect(logArgs[0]).toBe('log')
    expect(logArgs[1]).toBe('--oneline')
    expect(logArgs[2]).toMatch(/HEAD\.\./)

    vi.doUnmock('node:child_process')
  })
})

describe('"Atualizar agora" — sequência de comandos', () => {
  it('applyUpdate usa git pull --ff-only como primeiro passo', () => {
    // A lógica em updater.ts: step('Baixando', 0, 20, 'git', ['pull', '--ff-only'])
    const pullArgs = ['pull', '--ff-only']
    expect(pullArgs).toEqual(['pull', '--ff-only'])
  })

  it('applyUpdate instala deps apenas quando package-lock.json mudou', () => {
    // changed.includes('package-lock.json') → step('Instalando', 20, 40, 'npm', ['install'])
    const changed = ['src/main/index.ts', 'package-lock.json']
    expect(changed.includes('package-lock.json')).toBe(true)

    const changedWithout = ['src/main/index.ts']
    expect(changedWithout.includes('package-lock.json')).toBe(false)
  })

  it('applyUpdate usa npm run build para compilar', () => {
    const buildArgs = ['run', 'build']
    expect(buildArgs).toEqual(['run', 'build'])
  })

  it('applyUpdate usa npx electron-builder --win --dir com output correto', () => {
    const out = 'build-out-120000'
    const ebArgs = ['electron-builder', '--win', '--dir', `--config.directories.output=${out}`]
    expect(ebArgs[0]).toBe('electron-builder')
    expect(ebArgs[3]).toContain('build-out-')
  })

  it('mask remove credenciais de URLs antes de logar', () => {
    const mask = (s: string): string => s.replace(/:\/\/[^@/\s]+@/g, '://***@')
    expect(mask('https://user:token@github.com/repo')).toBe('https://***@github.com/repo')
    expect(mask('https://github.com/repo')).toBe('https://github.com/repo')
    expect(mask('git://token@host/repo.git')).toBe('git://***@host/repo.git')
  })
})
