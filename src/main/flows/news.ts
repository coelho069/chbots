import { newsLanguages, type NewsLanguage } from '@shared/flows'

export interface NewsItem {
  title: string
  source: string
  link: string
  // data original do feed (RFC 822); vazia se o item não trouxer
  pubDate: string
}

export function buildNewsUrl(topic: string, language: NewsLanguage): string {
  const ed = newsLanguages[language]
  const params = new URLSearchParams({ q: topic.trim(), hl: ed.hl, gl: ed.gl, ceid: ed.ceid })
  return `https://news.google.com/rss/search?${params.toString()}`
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code: string) => {
    const c = code.toLowerCase()
    if (c.startsWith('#x')) return String.fromCodePoint(parseInt(c.slice(2), 16))
    if (c.startsWith('#')) return String.fromCodePoint(parseInt(c.slice(1), 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[c] ?? whole
  })
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return ''
  const raw = m[1]!.trim()
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  return (cdata ? cdata[1]! : decodeEntities(raw)).replace(/\s+/g, ' ').trim()
}

// Lê os <item> de um RSS 2.0. Sem dependência de parser XML: o formato do Google Notícias é simples e estável.
export function parseNewsRss(xml: string): NewsItem[] {
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) throw new Error('A resposta do Google Notícias não é um feed RSS')
  const items: NewsItem[] = []
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]!
    const source = tagText(block, 'source')
    let title = tagText(block, 'title')
    // o Google acrescenta " - Fonte" ao título
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim()
    const link = tagText(block, 'link')
    if (!title || !link) continue
    items.push({ title, source: source || 'fonte não informada', link, pubDate: tagText(block, 'pubDate') })
  }
  return items
}

export function formatNewsDate(pubDate: string, timeZone?: string): string {
  const ms = Date.parse(pubDate)
  if (!pubDate || Number.isNaN(ms)) return pubDate || 'data não informada'
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone })
}

export function formatNews(items: NewsItem[], topic: string, opts: { timeZone?: string } = {}): string {
  if (items.length === 0) return `Nenhuma notícia encontrada no Google Notícias para "${topic.trim()}".`
  const header = `Notícias sobre "${topic.trim()}" (Google Notícias, ${items.length} ${items.length === 1 ? 'item' : 'itens'}):`
  const body = items.map(
    (it, i) =>
      `${i + 1}. ${it.title}\n   Fonte: ${it.source}\n   Data: ${formatNewsDate(it.pubDate, opts.timeZone)}\n   Link: ${it.link}`
  )
  return [header, ...body].join('\n\n')
}

const offlineCodes = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])

function networkCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause
  return cause?.code ?? cause?.errors?.[0]?.code
}

export async function fetchNews(args: {
  topic: string
  language: NewsLanguage
  count: number
  signal: AbortSignal
  fetchImpl?: typeof fetch
  timeZone?: string
}): Promise<string> {
  const topic = args.topic.trim()
  if (!topic) throw new Error('Informe o tema da busca de notícias')
  const doFetch = args.fetchImpl ?? fetch

  let res: Response
  try {
    res = await doFetch(buildNewsUrl(topic, args.language), {
      signal: args.signal,
      headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' }
    })
  } catch (err) {
    if (args.signal.aborted) throw err
    const code = networkCode(err)
    if (err instanceof TypeError || (code && offlineCodes.has(code)))
      throw new Error(`Sem conexão com a internet: não foi possível acessar news.google.com${code ? ` (${code})` : ''}.`)
    throw err
  }
  if (!res.ok) throw new Error(`O Google Notícias respondeu com erro HTTP ${res.status}.`)

  const items = parseNewsRss(await res.text()).slice(0, Math.max(1, args.count))
  return formatNews(items, topic, { timeZone: args.timeZone })
}
