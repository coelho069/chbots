// E2E dos Fluxos: servidor LLM falso + app empacotado dirigido via CDP + conferência direta no SQLite.
// Uso: npm run test:e2e  (gera o build antes). Screenshot opcional: node tests/e2e/flows.e2e.mjs <saida.png>
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const projectDir = join(import.meta.dirname, '..', '..')
const shotPath = process.argv[2] ?? null
const userData = mkdtempSync(join(tmpdir(), 'pilotos-flows-e2e-'))
const mdFolder = join(userData, 'saidas')
const LLM_PORT = 18081
const CDP_PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// O "modelo" aprova tudo e devolve o prompt recebido. Se o prompt pedir para demorar, fica 8 s calado.
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    const { messages } = JSON.parse(body)
    const last = messages.at(-1).content
    if (last.includes('DEMORE')) await sleep(8000)
    const reply = `APROVADO\n\n${last}`
    res.setHeader('content-type', 'text/event-stream')
    for (const piece of [reply.slice(0, 5), reply.slice(5)])
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
})
await new Promise((r) => server.listen(LLM_PORT, '127.0.0.1', r))

const electronExe = createRequire(import.meta.url)('electron')
const app = spawn(electronExe, [projectDir, `--user-data-dir=${userData}`, `--remote-debugging-port=${CDP_PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe']
})
let logs = ''
app.stdout.on('data', (d) => (logs += d))
app.stderr.on('data', (d) => (logs += d))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const node = (id, type, data, x) => ({ id, type, data, position: { x, y: 0 } })
const TRIGGER_INPUT = 'Tema da semana: energia solar em telhados'
const REFINE = 'Escreva um parágrafo objetivo sobre o tema'

let flowId = null
let slowFlowId = null
let agentId = null
try {
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('renderer/index.html'))
    } catch {}
  }
  if (!target) throw new Error('janela do app não apareceu')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
  let seq = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
  }
  const cdp = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const run = async (expr) => {
    const r = await cdp('Runtime.evaluate', {
      expression: `(async () => JSON.stringify(await (async () => { ${expr} })()))()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro no renderer')
    return JSON.parse(r.result.result.value ?? 'null')
  }
  const waitFor = async (expr, timeoutMs = 10_000) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const value = await run(expr)
      if (value) return value
      await sleep(200)
    }
    return null
  }
  await sleep(800)

  // ---- Dados de base ----
  const provider = await run(
    `return pilotos.providers.create({ kind: 'openai', name: 'Falso', baseUrl: 'http://127.0.0.1:${LLM_PORT}/v1', apiKey: 'sk-e2e' })`
  )
  const agent = await run(
    `return pilotos.agents.create({ name: 'Redator', color: '#4f7cff', systemPrompt: 'Redija.', providerId: ${provider.id}, model: 'fake', temperature: 0.3 })`
  )
  agentId = agent.id

  // ---- Fluxo principal: gatilho → agente → condição → (Sim) salvar .md / (Não) notificar ----
  const created = await run(`return pilotos.flows.create({ name: 'Boletim solar', description: 'teste ponta a ponta' })`)
  flowId = created.id
  const triggerId = created.graph.nodes[0].id
  check('fluxo novo nasce com um Gatilho', created.graph.nodes.length === 1 && created.graph.nodes[0].type === 'trigger')

  const graph = {
    nodes: [
      node(triggerId, 'trigger', { mode: 'manual', cron: '0 8 * * *', input: TRIGGER_INPUT }, 0),
      node('ag', 'agent', { agentId, refinePrompt: REFINE, timeoutSec: 30 }, 260),
      node('cd', 'condition', { operator: 'contains', value: 'aprovado', caseSensitive: false }, 520),
      { ...node('md', 'output', { action: 'save_md', folder: mdFolder, fileName: '{fluxo}.md', title: '', timeoutSec: 30 }, 780), position: { x: 780, y: -90 } },
      { ...node('nt', 'output', { action: 'notify', folder: '', fileName: '', title: 'Reprovado', timeoutSec: 30 }, 780), position: { x: 780, y: 110 } }
    ],
    edges: [
      { id: 'e1', source: triggerId, target: 'ag', conditionValue: null },
      { id: 'e2', source: 'ag', target: 'cd', conditionValue: null },
      { id: 'e3', source: 'cd', target: 'md', conditionValue: 'true' },
      { id: 'e4', source: 'cd', target: 'nt', conditionValue: 'false' }
    ]
  }
  const saveExpr = (g) =>
    `try { await pilotos.flows.save(${flowId}, { name: 'Boletim solar', description: 'teste ponta a ponta', graph: ${JSON.stringify(g)} }); return 'aceitou' } catch (e) { return e.message }`

  const cyclic = { ...graph, edges: [...graph.edges, { id: 'e5', source: 'cd', target: 'ag', conditionValue: 'false' }] }
  const cycleMsg = await run(saveExpr(cyclic))
  check('salvar com ciclo é recusado', cycleMsg.includes('ciclo'), cycleMsg.split('\n').find((l) => l.includes('ciclo')))

  const extra = Array.from({ length: 6 }, (_, i) => node(`x${i}`, 'agent', { agentId, refinePrompt: '', timeoutSec: 30 }, 0))
  const big = { nodes: [...graph.nodes, ...extra], edges: [...graph.edges, ...extra.map((n) => ({ id: `ex-${n.id}`, source: 'ag', target: n.id, conditionValue: null }))] }
  const bigMsg = await run(saveExpr(big))
  check('salvar com 11 nós é recusado', bigMsg.includes('o limite é 10'), bigMsg.split('\n').find((l) => l.includes('limite')))

  const ok = await run(saveExpr(graph))
  check('fluxo válido é salvo', ok === 'aceitou', ok)

  // ---- Executa pela interface ----
  await cdp('Page.reload')
  await sleep(1500)
  await run(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent === 'Fluxos').click()`)
  const opened = await waitFor(`
    const item = [...document.querySelectorAll('.flows-page .item')].find((i) => i.textContent.includes('Boletim solar'))
    if (!item) return false
    item.click()
    return true`)
  const nodesShown = await waitFor(`const n = document.querySelectorAll('.fnode').length; return n === 5 ? n : 0`)
  check('editor abre o fluxo com os 5 nós', opened && nodesShown === 5)

  await run(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Rodar agora').click()`)
  const finished = await waitFor(
    `const s = document.querySelector('.run-item .status'); return s && !s.classList.contains('status-running') ? s.textContent : null`,
    20_000
  )
  check('execução pela UI termina como Concluída', finished === 'Concluída', finished)
  await sleep(300)

  const classes = await run(`
    return Object.fromEntries([...document.querySelectorAll('.fnode')].map((el) => {
      const st = [...el.classList].find((c) => c.startsWith('status-'))
      return [el.dataset.nodeId, st]
    }))`)
  check(
    'nós percorridos ficam verdes e o ramo "Não" fica ignorado',
    classes[triggerId] === 'status-success' && classes.ag === 'status-success' && classes.cd === 'status-success' &&
      classes.md === 'status-success' && classes.nt === 'status-skipped',
    JSON.stringify(classes)
  )

  // Clique em um nó no modo Execução abre o modal com entrada e saída.
  await run(`document.querySelector('.react-flow__node[data-id="ag"]').click()`)
  const modal = await waitFor(`
    const m = document.querySelector('.modal')
    return m ? [...m.querySelectorAll('.payload')].map((p) => p.textContent) : null`)
  check(
    'modal do nó mostra entrada e saída',
    // entrada = o que chegou do nó anterior; o Prompt de Refinamento entra na chamada e o modelo falso o ecoa na saída
    modal?.length >= 2 && modal[0] === TRIGGER_INPUT && modal[1].startsWith('APROVADO') && modal[1].includes(REFINE),
    modal ? `${modal.length} blocos` : 'modal não abriu'
  )
  const modalTitle = await run(`return document.querySelector('.modal-head h3')?.textContent`)
  check('título do modal traz o nome do agente', modalTitle === 'Agente · Redator', modalTitle)
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  check('Esc fecha o modal', await waitFor(`return !document.querySelector('.modal')`, 2000))
  if (shotPath) {
    await sleep(300)
    const shot = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
    // recorte ampliado dos nós, para conferir as bordas de estado
    const box = await run(`
      const rs = [...document.querySelectorAll('.fnode')].map((el) => el.getBoundingClientRect())
      const x = Math.min(...rs.map((r) => r.left)) - 16, y = Math.min(...rs.map((r) => r.top)) - 16
      return { x, y, width: Math.max(...rs.map((r) => r.right)) + 16 - x, height: Math.max(...rs.map((r) => r.bottom)) + 16 - y }`)
    const zoom = await cdp('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2.5 } })
    writeFileSync(shotPath.replace(/\.png$/, '-nos.png'), Buffer.from(zoom.result.data, 'base64'))
  }

  // ---- Tempo limite por nó: o modelo demora 8 s, o nó aceita 5 s ----
  const slow = await run(`return pilotos.flows.create({ name: 'Lento', description: '' })`)
  slowFlowId = slow.id
  const slowTrigger = slow.graph.nodes[0].id
  const slowGraph = {
    nodes: [
      node(slowTrigger, 'trigger', { mode: 'manual', cron: '0 8 * * *', input: 'DEMORE' }, 0),
      node('lento', 'agent', { agentId, refinePrompt: '', timeoutSec: 5 }, 260),
      node('fim', 'output', { action: 'save_md', folder: mdFolder, fileName: 'lento.md', title: '', timeoutSec: 30 }, 520)
    ],
    edges: [
      { id: 's1', source: slowTrigger, target: 'lento', conditionValue: null },
      { id: 's2', source: 'lento', target: 'fim', conditionValue: null }
    ]
  }
  await run(`return pilotos.flows.save(${slowFlowId}, { name: 'Lento', description: '', graph: ${JSON.stringify(slowGraph)} })`)
  await run(`return pilotos.flows.run(${slowFlowId})`)
  const slowRun = await waitFor(`const [r] = await pilotos.flows.runs(${slowFlowId}); return r && r.status !== 'running' ? r : null`, 15_000)
  check('nó que estoura o tempo limite falha a execução', slowRun?.status === 'error' && slowRun.error === 'Tempo esgotado (5s)', slowRun?.error)
  ws.close()
} catch (err) {
  check('execução do roteiro', false, err.stack ?? err.message)
} finally {
  app.kill()
  server.close()
  await sleep(1200)
}

// ---- Conferência direta no SQLite, com o app fechado ----
const dbFile = join(userData, 'pilotos.db')
if (existsSync(dbFile)) {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const graphRows = db.prepare('SELECT COUNT(*) AS n FROM flow_nodes WHERE flow_id = ?').get(flowId).n
  const edgeRows = db.prepare("SELECT COUNT(*) AS n FROM flow_edges WHERE flow_id = ? AND condition_value IS NOT NULL").get(flowId).n
  check('grafo gravado em flow_nodes/flow_edges', graphRows === 5 && edgeRows === 2, `${graphRows} nós, ${edgeRows} ligações Sim/Não`)

  const mainRuns = db.prepare('SELECT * FROM flow_runs WHERE flow_id = ?').all(flowId)
  const mainRun = mainRuns[0]
  const path = mainRun ? JSON.parse(mainRun.path_json) : []
  check(
    'flow_runs: uma execução manual, status ok, com horário e caminho exato',
    mainRuns.length === 1 && mainRun.status === 'ok' && mainRun.trigger === 'manual' && mainRun.started_at && mainRun.finished_at &&
      path.slice(1).join() === 'ag,cd,md',
    mainRun?.path_json
  )
  const steps = db.prepare('SELECT * FROM flow_run_steps WHERE run_id = ? ORDER BY id').all(mainRun?.id ?? -1)
  const byNode = Object.fromEntries(steps.map((s) => [s.node_id, s]))
  check(
    'flow_run_steps: saída de cada nó vira a entrada do seguinte',
    byNode.ag?.input.includes(TRIGGER_INPUT) && byNode.cd?.input === byNode.ag?.output && byNode.md?.input === byNode.cd?.output &&
      byNode.md?.output.startsWith('Arquivo salvo:'),
    `${steps.length} passos`
  )
  check('flow_run_steps: ramo não escolhido gravado como ignorado', byNode.nt?.status === 'skipped' && byNode.nt.output === null)

  const slowRow = db.prepare('SELECT * FROM flow_runs WHERE flow_id = ?').get(slowFlowId)
  check('execução com erro gravada com caminho parcial', slowRow?.status === 'error' && JSON.parse(slowRow.path_json).at(-1) === 'lento', slowRow?.path_json)
  const slowSteps = db.prepare('SELECT node_id, status FROM flow_run_steps WHERE run_id = ? ORDER BY id').all(slowRow?.id ?? -1)
  check('passo seguinte ao erro gravado como ignorado', slowSteps.at(-1)?.node_id === 'fim' && slowSteps.at(-1)?.status === 'skipped')
  db.close()
} else {
  check('banco criado na pasta de dados', false)
}

// O .md é a prova persistida da execução feita pela UI.
const files = existsSync(mdFolder) ? readdirSync(mdFolder) : []
const md = files.includes('Boletim solar.md') ? readFileSync(join(mdFolder, 'Boletim solar.md'), 'utf8') : ''
check('arquivo .md salvo com a saída do agente', md.startsWith('APROVADO') && md.includes(REFINE) && md.includes(TRIGGER_INPUT), files.join(', '))
check('nó após o tempo esgotado não gravou arquivo', !files.includes('lento.md'))

const expected = /handler for 'flows:(save|get)'/
const errors = logs.split('\n').filter((l) => /error occurred|uncaught|unhandled/i.test(l) && !expected.test(l))
check('sem erros inesperados no log do processo', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} verificações ok`)
if (results.every((r) => r.ok)) rmSync(userData, { recursive: true, force: true })
else console.log(`dados mantidos para inspeção em ${userData}`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
