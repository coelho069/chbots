// Buscar atualização: git fetch/pull + build + novo empacotamento, depois abre o app novo. Roda a partir do repositório do projeto.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { AppVersion, UpdateCheck, UpdateStatus } from '@shared/types'

const findRepo = (): string | null => {
  for (let d = dirname(process.execPath); ; d = dirname(d)) {
    if (existsSync(join(d, '.git')) && existsSync(join(d, 'package.json'))) return d
    if (dirname(d) === d) return null
  }
}

const repo = findRepo()
const gitSync = (args: string[]): string => execFileSync('git', args, { cwd: repo ?? undefined, encoding: 'utf8', windowsHide: true }).trim()

// Fixo ao subir: depois do git pull o HEAD já mudou, mas o app em execução ainda é o antigo.
let version: AppVersion = { version: app.getVersion(), commit: 'dev' }
try { if (repo) version = { ...version, commit: gitSync(['rev-parse', '--short', 'HEAD']) } } catch { /* sem git: fica "dev" */ }
export const getVersion = (): AppVersion => version

// Remove credenciais de URLs (https://user:token@host) antes de qualquer log.
const mask = (s: string): string => s.replace(/:\/\/[^@/\s]+@/g, '://***@')

function run(cmd: string, args: string[], onLine: (l: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = ''
    const p = spawn(cmd, args, { cwd: repo ?? undefined, shell: true, windowsHide: true }) // args fixos, nada vem do usuário
    const feed = (b: Buffer): void => { out += b; b.toString().split(/\r?\n/).filter(Boolean).forEach((l) => onLine(mask(l))) }
    p.stdout.on('data', feed)
    p.stderr.on('data', feed)
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} saiu com código ${code}`))))
  })
}

export async function checkUpdate(): Promise<UpdateCheck> {
  if (!repo) return { behind: 0, commits: [], error: 'Repositório git não encontrado ao lado do app.' }
  try {
    const noop = (): void => {}
    await run('git', ['fetch'], noop)
    const upstream = gitSync(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const commits = gitSync(['log', '--oneline', `HEAD..${upstream}`]).split('\n').filter(Boolean)
    return { behind: commits.length, commits }
  } catch (e) {
    return { behind: 0, commits: [], error: mask(e instanceof Error ? e.message : String(e)) }
  }
}

const status: UpdateStatus = { running: false, log: [], error: null, done: false }
export const getUpdateStatus = (): UpdateStatus => ({ ...status, log: status.log.slice(-200) })

export function applyUpdate(): void {
  if (status.running || !repo) return
  Object.assign(status, { running: true, log: [], error: null, done: false })
  const log = (l: string): void => { status.log.push(l) }
  void (async () => {
    try {
      const before = gitSync(['rev-parse', 'HEAD'])
      log('> git pull --ff-only'); await run('git', ['pull', '--ff-only'], log)
      const changed = gitSync(['diff', '--name-only', before, 'HEAD']).split('\n')
      if (changed.includes('package-lock.json')) { log('> npm install'); await run('npm', ['install'], log) }
      log('> npm run build'); await run('npm', ['run', 'build'], log)
      const out = `build-out-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`
      log('> empacotando em ' + out); await run('npx', ['electron-builder', '--win', '--dir', `--config.directories.output=${out}`], log)
      const exe = join(repo, out, 'win-unpacked', 'CH BOTS.exe')
      if (!existsSync(exe)) throw new Error('Build incompleto: executável novo não encontrado')
      log('Pronto. Reiniciando…'); status.done = true
      // O app novo só sobe depois que este sair (trava de instância única).
      spawn('cmd', ['/c', `ping -n 4 127.0.0.1 >nul & start "" "${exe}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      setTimeout(() => app.exit(0), 1500)
    } catch (e) {
      status.error = mask(e instanceof Error ? e.message : String(e))
    } finally {
      status.running = false
    }
  })()
}
