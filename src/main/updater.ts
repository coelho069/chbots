// Buscar atualização: git fetch/pull + build + novo empacotamento, depois abre o app novo. Roda a partir do repositório do projeto.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { events } from '@shared/ipc'
import type { AppVersion, LastUpdate, UpdateCheck, UpdateStatus } from '@shared/types'
import type { Db } from './db/connection'
import { getSettings, saveSettings } from './db/repos/settings'

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
// HEAD vivo do repositório (o build em execução pode estar atrás dele) + dados de onde o programa roda.
export function getAccessInfo(): Omit<import('@shared/types').AccessInfo, 'port' | 'listening' | 'uptimeSec'> {
  let head = 'dev'
  try { if (repo) head = gitSync(['rev-parse', '--short', 'HEAD']) } catch { /* sem git */ }
  let buildDate = ''
  try { buildDate = statSync(process.execPath).mtime.toISOString() } catch { /* ignora */ }
  return { ...version, head, runDir: basename(dirname(dirname(process.execPath))), buildDate }
}

export const getVersion = (): AppVersion => version

// index.ts liga isto ao send() que já alimenta a janela e o SSE do navegador.
let emit: (channel: string, payload: unknown) => void = () => {}
export const setUpdateEmitter = (fn: typeof emit): void => { emit = fn }

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
    await run('git', ['fetch'], () => {})
    const upstream = gitSync(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const commits = gitSync(['log', '--oneline', `HEAD..${upstream}`]).split('\n').filter(Boolean)
    return { behind: commits.length, commits }
  } catch (e) {
    return { behind: 0, commits: [], error: mask(e instanceof Error ? e.message : String(e)) }
  }
}

const status: UpdateStatus = { running: false, log: [], error: null, done: false, etapa: '', percent: 0, failedEtapa: null }
export const getUpdateStatus = (): UpdateStatus => ({ ...status, log: status.log.slice(-200) })

function progress(etapa: string, percent: number, line = ''): void {
  status.etapa = etapa
  status.percent = Math.round(percent)
  emit(events.updateProgress, { etapa, percent: status.percent, log: line, error: status.error })
}

// O comando não informa quanto falta: dentro da faixa da etapa, a barra avança conforme chegam linhas de log.
async function step(etapa: string, from: number, to: number, cmd: string, args: string[]): Promise<void> {
  progress(etapa, from)
  let n = 0
  await run(cmd, args, (l) => {
    status.log.push(l)
    n++
    progress(etapa, from + (to - from) * (1 - Math.exp(-n / 40)), l)
  })
  progress(etapa, to)
}

// Mantém só a pasta nova e a do app em execução (travada pelo Windows); apaga as demais.
function pruneBuilds(root: string, newest: string): void {
  const running = dirname(dirname(process.execPath))
  for (const n of readdirSync(root).filter((x) => x.startsWith('build-out'))) {
    const dir = join(root, n)
    if (n === newest || dir === running || !statSync(dir).isDirectory()) continue
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* em uso: fica para a próxima */ }
  }
}

export function applyUpdate(db: Db): void {
  if (status.running || !repo) return
  Object.assign(status, { running: true, log: [], error: null, done: false, etapa: '', percent: 0, failedEtapa: null })
  void (async () => {
    try {
      const before = gitSync(['rev-parse', 'HEAD'])
      await step('Baixando (git pull)', 0, 20, 'git', ['pull', '--ff-only'])
      const changed = gitSync(['diff', '--name-only', before, 'HEAD']).split('\n')
      if (changed.includes('package-lock.json')) await step('Instalando dependências (npm install)', 20, 40, 'npm', ['install'])
      await step('Compilando (npm run build)', 40, 70, 'npm', ['run', 'build'])
      const out = `build-out-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`
      await step('Empacotando (electron-builder)', 70, 95, 'npx', ['electron-builder', '--win', '--dir', `--config.directories.output=${out}`])
      const exe = join(repo, out, 'win-unpacked', 'CH BOTS.exe')
      if (!existsSync(exe)) throw new Error('Build incompleto: executável novo não encontrado')

      progress('Abrindo nova versão', 95)
      const last: LastUpdate = {
        commitAntigo: before.slice(0, 7),
        commitNovo: gitSync(['rev-parse', '--short', 'HEAD']),
        versao: (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }).version,
        data: new Date().toISOString(),
        commits: gitSync(['log', '--oneline', `${before}..HEAD`]).split('\n').filter(Boolean)
      }
      saveSettings(db, { ...getSettings(db), lastUpdate: JSON.stringify(last) })
      pruneBuilds(repo, out)
      status.done = true
      progress('Abrindo nova versão', 100)
      // O app novo só sobe depois que este sair (trava de instância única).
      spawn('cmd', ['/c', `ping -n 4 127.0.0.1 >nul & start "" "${exe}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      setTimeout(() => app.exit(0), 1500)
    } catch (e) {
      status.error = mask(e instanceof Error ? e.message : String(e))
      status.failedEtapa = status.etapa
      progress(status.etapa, status.percent)
    } finally {
      status.running = false
    }
  })()
}

const RECENT_MS = 10 * 60 * 1000
const parse = (raw: string): LastUpdate | null => { try { return raw ? (JSON.parse(raw) as LastUpdate) : null } catch { return null } }

// Só devolve se for recente; qualquer outra coisa é lixo e é limpa.
export function takeLastUpdate(db: Db): LastUpdate | null {
  const s = getSettings(db)
  const last = parse(s.lastUpdate)
  if (last && Date.now() - Date.parse(last.data) < RECENT_MS) return last
  if (s.lastUpdate) saveSettings(db, { ...s, lastUpdate: '' })
  return null
}

export const clearLastUpdate = (db: Db): void => { saveSettings(db, { ...getSettings(db), lastUpdate: '' }) }
