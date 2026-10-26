// Roda o Claude Code CLI (`claude -p`) apontado para o Ollama local, sem tocar no env global.
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

export const OLLAMA_URL = 'http://localhost:11434'
export const DEFAULT_CLAUDE_CODE_MODEL = 'qwen2.5:0.5b'
export const DEFAULT_CLAUDE_CODE_TIMEOUT_MIN = 15
const MAX_OUTPUT = 2_000_000

export interface ClaudeCodeResult {
  ok: boolean
  resposta: string
  erro: string
}

// Versão do Ollama, ou erro se não responder em 3 s.
export async function checkOllama(): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return ((await res.json()) as { version?: string }).version ?? '?'
  } catch {
    throw new Error('Ollama não está rodando')
  }
}

export async function runClaudeCode(
  { tarefa, pasta, modelo, timeoutMin = DEFAULT_CLAUDE_CODE_TIMEOUT_MIN }: { tarefa: string; pasta: string; modelo: string; timeoutMin?: number },
  signal?: AbortSignal
): Promise<ClaudeCodeResult> {
  const fail = (erro: string): ClaudeCodeResult => ({ ok: false, resposta: '', erro })
  if (!tarefa.trim()) return fail('Tarefa vazia')
  // sem '-' inicial: o CLI leria o nome do modelo como opção
  if (!/^[\w.:/-]+$/.test(modelo) || modelo.startsWith('-')) return fail(`Modelo inválido: ${modelo}`)
  try {
    if (!(await stat(pasta)).isDirectory()) return fail(`Não é uma pasta: ${pasta}`)
  } catch {
    return fail(`Pasta não encontrada: ${pasta}`)
  }
  try {
    await checkOllama()
  } catch (err) {
    return fail((err as Error).message)
  }

  return new Promise((resolve) => {
    // '--' impede que uma tarefa começando com '-' vire opção; sem shell, nada é interpretado
    const child = spawn('claude', ['-p', '--output-format', 'json', '--model', modelo, '--', tarefa], {
      cwd: pasta,
      env: { ...process.env, ANTHROPIC_BASE_URL: OLLAMA_URL, ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const done = (r: ClaudeCodeResult) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(r)
    }
    const timer = setTimeout(() => {
      child.kill()
      done(fail(`Tempo esgotado (${timeoutMin} min)`))
    }, timeoutMin * 60_000)
    const onAbort = () => {
      child.kill()
      done(fail('Execução cancelada'))
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8') })
    child.on('error', (err: NodeJS.ErrnoException) =>
      done(fail(err.code === 'ENOENT' ? 'Claude Code (claude) não encontrado no PATH' : err.message))
    )
    child.on('close', (code) => {
      try {
        const out = JSON.parse(stdout) as { result?: string; is_error?: boolean }
        const resposta = out.result ?? ''
        done(out.is_error ? { ok: false, resposta, erro: resposta || 'Claude Code retornou erro' } : { ok: true, resposta, erro: '' })
      } catch {
        done(fail(stderr.trim() || stdout.trim() || `Claude Code saiu com código ${code}`))
      }
    })
  })
}
