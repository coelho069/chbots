import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultNodeData, validateGraph, type FlowGraph, type FlowNode } from '../src/shared/flows'
import { flowGraphInput } from '../src/shared/schemas'
import { openDatabase } from '../src/main/db/connection'
import { migrations } from '../src/main/db/migrations'
import { getFlowGraph, insertFlow, saveFlow } from '../src/main/db/repos/flows'
import { executeFlow, type EngineActions } from '../src/main/flows/engine'
import { buildNewsUrl, fetchNews, formatNews, parseNewsRss } from '../src/main/flows/news'
import { flowTemplates } from '../src/renderer/src/flows/templates'

// Feed no formato do Google Notícias: título com " - Fonte", CDATA, entidades e um item sem link.
const fakeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>"inteligência artificial" - Google Notícias</title>
    <item>
      <title>IA generativa chega aos hospitais - G1</title>
      <link>https://news.google.com/rss/articles/AAA1?oc=5</link>
      <guid isPermaLink="false">AAA1</guid>
      <pubDate>Sat, 24 Oct 2026 10:30:00 GMT</pubDate>
      <description>&lt;a href="x"&gt;resumo&lt;/a&gt;</description>
      <source url="https://g1.globo.com">G1</source>
    </item>
    <item>
      <title><![CDATA[Startups & governo discutem <regras> - Folha]]></title>
      <link>https://news.google.com/rss/articles/BBB2?oc=5</link>
      <pubDate>Fri, 23 Oct 2026 22:05:00 GMT</pubDate>
      <source url="https://folha.uol.com.br">Folha</source>
    </item>
    <item>
      <title>Chips &amp; &quot;modelos&quot; abertos - Estadão</title>
      <link>https://news.google.com/rss/articles/CCC3?oc=5</link>
      <pubDate>data estranha</pubDate>
      <source url="https://estadao.com.br">Estadão</source>
    </item>
    <item>
      <title>Item sem link - Ninguém</title>
      <source url="https://x">Ninguém</source>
    </item>
  </channel>
</rss>`

function fakeFetch(body: string, init: { status?: number } = {}) {
  const urls: string[] = []
  const impl = (async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'application/rss+xml' } })
  }) as typeof fetch
  return { impl, urls }
}

const signal = () => new AbortController().signal

afterEach(() => {
  vi.useRealTimers()
})

describe('Buscar notícias: URL e leitura do RSS', () => {
  it('monta a URL do Google Notícias em pt-BR com o tema codificado', () => {
    expect(buildNewsUrl('  inteligência artificial ', 'pt-BR')).toBe(
      'https://news.google.com/rss/search?q=intelig%C3%AAncia+artificial&hl=pt-BR&gl=BR&ceid=BR%3Apt-419'
    )
  })

  it('não deixa o tema injetar parâmetros na URL', () => {
    const url = new URL(buildNewsUrl('ia&hl=en-US', 'pt-BR'))
    expect(url.searchParams.get('q')).toBe('ia&hl=en-US')
    expect(url.searchParams.getAll('hl')).toEqual(['pt-BR'])
  })

  it('lê título, fonte, data e link; tira o " - Fonte" do título; ignora item sem link', () => {
    const items = parseNewsRss(fakeFeed)
    expect(items).toEqual([
      { title: 'IA generativa chega aos hospitais', source: 'G1', link: 'https://news.google.com/rss/articles/AAA1?oc=5', pubDate: 'Sat, 24 Oct 2026 10:30:00 GMT' },
      { title: 'Startups & governo discutem <regras>', source: 'Folha', link: 'https://news.google.com/rss/articles/BBB2?oc=5', pubDate: 'Fri, 23 Oct 2026 22:05:00 GMT' },
      { title: 'Chips & "modelos" abertos', source: 'Estadão', link: 'https://news.google.com/rss/articles/CCC3?oc=5', pubDate: 'data estranha' }
    ])
  })

  it('recusa resposta que não é RSS', () => {
    expect(() => parseNewsRss('<html><body>captcha</body></html>')).toThrow(/não é um feed RSS/)
  })

  it('formata a lista em texto com título, fonte, data e link', () => {
    const text = formatNews(parseNewsRss(fakeFeed), 'inteligência artificial', { timeZone: 'UTC' })
    expect(text).toContain('Notícias sobre "inteligência artificial" (Google Notícias, 3 itens):')
    expect(text).toContain(
      '1. IA generativa chega aos hospitais\n   Fonte: G1\n   Data: 24/10/2026, 10:30\n   Link: https://news.google.com/rss/articles/AAA1?oc=5'
    )
    // data que não dá para interpretar passa como veio
    expect(text).toContain('Data: data estranha')
  })

  it('avisa quando não há notícias', () => {
    expect(formatNews([], 'tema raro')).toBe('Nenhuma notícia encontrada no Google Notícias para "tema raro".')
  })
})

describe('Buscar notícias: download', () => {
  it('busca a URL certa e respeita a quantidade', async () => {
    const { impl, urls } = fakeFetch(fakeFeed)
    const text = await fetchNews({ topic: 'IA', language: 'pt-BR', count: 2, signal: signal(), fetchImpl: impl, timeZone: 'UTC' })
    expect(urls).toEqual(['https://news.google.com/rss/search?q=IA&hl=pt-BR&gl=BR&ceid=BR%3Apt-419'])
    expect(text).toContain('2 itens')
    expect(text).toContain('2. Startups')
    expect(text).not.toContain('Chips')
  })

  it('dá erro claro sem internet', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND news.google.com'), { code: 'ENOTFOUND' }) })
    }) as typeof fetch
    await expect(fetchNews({ topic: 'IA', language: 'pt-BR', count: 10, signal: signal(), fetchImpl: offline })).rejects.toThrow(
      'Sem conexão com a internet: não foi possível acessar news.google.com (ENOTFOUND).'
    )
  })

  it('dá erro claro com resposta HTTP de erro', async () => {
    const { impl } = fakeFetch('indisponível', { status: 503 })
    await expect(fetchNews({ topic: 'IA', language: 'pt-BR', count: 10, signal: signal(), fetchImpl: impl })).rejects.toThrow(
      'O Google Notícias respondeu com erro HTTP 503.'
    )
  })

  it('recusa tema vazio', async () => {
    const { impl, urls } = fakeFetch(fakeFeed)
    await expect(fetchNews({ topic: '  ', language: 'pt-BR', count: 10, signal: signal(), fetchImpl: impl })).rejects.toThrow(/tema/)
    expect(urls).toEqual([])
  })
})

// ---- Nó no motor ----

const n = (id: string, type: FlowNode['type'], data: object = {}): FlowNode =>
  ({ id, type, data: { ...defaultNodeData(type), ...data }, position: { x: 0, y: 0 } }) as FlowNode

function actionsWith(fetchNewsImpl: EngineActions['fetchNews']) {
  const prompts: string[] = []
  const actions: EngineActions = {
    runAgent: async ({ prompt }) => (prompts.push(prompt), 'resumo'),
    saveMarkdown: async () => 'C:\\fake.md',
    notify: () => undefined,
    fetchNews: fetchNewsImpl,
    generatePrompt: async () => 'prompt',
    memorySave: async () => 'salvo',
    memorySearch: async () => '',
    delegateTask: async () => ''
  }
  return { actions, prompts }
}

describe('Buscar notícias: no fluxo', () => {
  const graph: FlowGraph = {
    nodes: [n('t', 'trigger'), n('news', 'news', { topic: 'IA', count: 5 }), n('a', 'agent', { agentId: 1, refinePrompt: 'Resuma.' })],
    edges: [
      { id: 'e1', source: 't', target: 'news', conditionValue: null },
      { id: 'e2', source: 'news', target: 'a', conditionValue: null }
    ]
  }

  it('a lista de notícias vira a entrada do próximo nó', async () => {
    const { impl } = fakeFetch(fakeFeed)
    const { actions, prompts } = actionsWith((args) => fetchNews({ ...args, fetchImpl: impl, timeZone: 'UTC' }))
    const r = await executeFlow(graph, { flowName: 'F', actions })
    expect(r.status).toBe('ok')
    expect(r.path).toEqual(['t', 'news', 'a'])
    expect(prompts[0]).toBe(`Resuma.\n\n--- Entrada ---\n${r.outputs.news}`)
    expect(r.outputs.news).toContain('Link: https://news.google.com/rss/articles/AAA1?oc=5')
  })

  it('usa o tempo limite de 30 s por padrão e cancela a busca', async () => {
    vi.useFakeTimers()
    let aborted = false
    const { actions } = actionsWith(
      ({ signal }) =>
        new Promise<string>(() => {
          signal.addEventListener('abort', () => (aborted = true))
        })
    )
    const pending = executeFlow(graph, { flowName: 'F', actions })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toMatchObject({ status: 'error', error: 'Tempo esgotado (30s)', path: ['t', 'news'] })
    expect(aborted).toBe(true)
  })

  it('erro de rede aparece no passo e para o fluxo', async () => {
    const { actions, prompts } = actionsWith(async () => {
      throw new Error('Sem conexão com a internet: não foi possível acessar news.google.com (ENOTFOUND).')
    })
    const r = await executeFlow(graph, { flowName: 'F', actions })
    expect(r).toMatchObject({ status: 'error', error: expect.stringContaining('Sem conexão com a internet') })
    expect(prompts).toEqual([])
  })

  it('validação exige o tema', () => {
    const g: FlowGraph = { ...graph, nodes: graph.nodes.map((x) => (x.id === 'news' ? n('news', 'news', { topic: ' ' }) : x)) }
    expect(validateGraph(g)).toEqual(['Buscar notícias: informe o tema.'])
  })

  it('zod aceita o nó e recusa idioma ou quantidade fora do permitido', () => {
    expect(flowGraphInput.safeParse(graph).success).toBe(true)
    const bad = (data: object) => ({ ...graph, nodes: [graph.nodes[0], n('news', 'news', { topic: 'IA', ...data }), graph.nodes[2]] })
    expect(flowGraphInput.safeParse(bad({ language: 'fr-FR' })).success).toBe(false)
    expect(flowGraphInput.safeParse(bad({ count: 0 })).success).toBe(false)
    expect(flowGraphInput.safeParse(bad({ count: 31 })).success).toBe(false)
  })
})

describe('Buscar notícias: banco e modelo pronto', () => {
  it('migra um banco antigo sem perder as ligações e passa a aceitar o nó', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pilotos-news-')), 'old.db')
    const old = new DatabaseSync(file)
    old.exec('PRAGMA foreign_keys = ON')
    old.exec(migrations[0]!)
    old.exec(migrations[1]!)
    old.exec('PRAGMA user_version = 2')
    old.exec(`INSERT INTO flows (id, name, created_at, updated_at) VALUES (1, 'Antigo', 'x', 'x')`)
    old.exec(`INSERT INTO flow_nodes VALUES ('t', 1, 'trigger', '{}', 0, 0), ('o', 1, 'output', '{}', 1, 1)`)
    old.exec(`INSERT INTO flow_edges VALUES ('e', 1, 't', 'o', NULL)`)
    old.close()

    const db = openDatabase(file)
    expect(db.prepare('SELECT id, source_node, target_node FROM flow_edges').all()).toEqual([
      { id: 'e', source_node: 't', target_node: 'o' }
    ])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    const g: FlowGraph = {
      nodes: [n('t2', 'trigger'), n('n2', 'news', { topic: 'IA' })],
      edges: [{ id: 'e2', source: 't2', target: 'n2', conditionValue: null }]
    }
    const flow = insertFlow(db, { name: 'Novo', description: '' }, { nodes: [], edges: [] })
    saveFlow(db, flow.id, { name: 'Novo', description: '' }, g)
    expect(getFlowGraph(db, flow.id).nodes.map((x) => x.type)).toEqual(['trigger', 'news'])
    // apagar o fluxo antigo ainda leva as ligações junto (cascata refeita)
    db.exec('DELETE FROM flows WHERE id = 1')
    expect(db.prepare('SELECT COUNT(*) AS c FROM flow_edges WHERE flow_id = 1').get()).toEqual({ c: 0 })
    db.close()
  })

  it('modelo "Resumo de notícias": 8h → notícias → agente → .md, só falta escolher o agente', () => {
    const tpl = flowTemplates.find((t) => t.name === 'Resumo de notícias')!
    const byType = (type: string) => tpl.graph.nodes.filter((x) => x.type === type)
    expect(byType('trigger')[0]!.data).toMatchObject({ mode: 'schedule', cron: '0 8 * * *' })
    expect(byType('news')[0]!.data).toMatchObject({ language: 'pt-BR', count: 10, timeoutSec: 30 })
    expect(byType('agent')[0]!.data).toMatchObject({
      refinePrompt: expect.stringContaining('{{entrada}}')
    })
    expect(byType('output')[0]!.data).toMatchObject({ action: 'save_md' })
    expect(tpl.graph.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['n1>n2', 'n2>n3', 'n3>n4'])
    expect(flowGraphInput.safeParse(tpl.graph).success).toBe(true)
    expect(validateGraph(tpl.graph)).toEqual(['Agente: escolha um agente.'])
  })
})
