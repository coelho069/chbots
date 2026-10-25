import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

export interface MarkdownCodeBlock {
  type: 'code'
  language: string
  content: string
}

export type MarkdownBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | MarkdownCodeBlock

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let list: Extract<MarkdownBlock, { type: 'unordered-list' | 'ordered-list' }> | null = null
  let code: { language: string; lines: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }

  for (const line of lines) {
    if (code) {
      if (/^\s*```\s*$/.test(line)) {
        blocks.push({ type: 'code', language: code.language, content: code.lines.join('\n') })
        code = null
      } else {
        code.lines.push(line)
      }
      continue
    }

    const fence = line.match(/^\s*```\s*([^\s`]*)\s*$/)
    if (fence) {
      flushParagraph(); flushList()
      code = { language: fence[1] ?? '', lines: [] }
      continue
    }

    if (!line.trim()) { flushParagraph(); flushList(); continue }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flushParagraph(); flushList()
      blocks.push({ type: 'heading', level: heading[1]!.length, content: heading[2]! })
      continue
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const type = unordered ? 'unordered-list' : 'ordered-list'
      if (!list || list.type !== type) { flushList(); list = { type, items: [] } }
      list!.items.push((unordered ?? ordered)![1]!)
      continue
    }

    flushList()
    paragraph.push(line)
  }

  if (code) blocks.push({ type: 'code', language: code.language, content: code.lines.join('\n') })
  flushParagraph(); flushList()
  return blocks
}

function inlineMarkdown(source: string): ReactNode[] {
  const token = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__)/g
  const result: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = token.exec(source))) {
    if (match.index > last) result.push(source.slice(last, match.index))
    const raw = match[0]
    if (raw.startsWith('`')) result.push(<code key={key++}>{raw.slice(1, -1)}</code>)
    else result.push(<strong key={key++}>{raw.slice(2, -2)}</strong>)
    last = match.index + raw.length
  }
  if (last < source.length) result.push(source.slice(last))
  return result
}

export function MarkdownCodeBlock({ language, content, showPromptCopy = false }: MarkdownCodeBlock & { showPromptCopy?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2_000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <button type="button" className="markdown-code-copy" onClick={() => void copyCode()}>
          {copied ? 'Copiado ✓' : 'Copiar'}
        </button>
        <span>{language || 'código'}</span>
      </div>
      <pre><code>{content}</code></pre>
      {showPromptCopy && (
        <button type="button" className="markdown-copy-prompt" onClick={() => void copyCode()}>
          {copied ? 'Copiado ✓' : 'Copiar prompt'}
        </button>
      )}
    </div>
  )
}

export function MarkdownContent({ source }: { source: string }) {
  const blocks = parseMarkdownBlocks(source)
  const codeBlocks = blocks.filter((block): block is MarkdownCodeBlock => block.type === 'code')
  return (
    <div className="markdown-content">
      {blocks.map((block, index) => {
        if (block.type === 'code') return <MarkdownCodeBlock key={index} {...block} showPromptCopy={codeBlocks.length === 1} />
        if (block.type === 'heading') {
          const content = inlineMarkdown(block.content)
          if (block.level === 1) return <h1 key={index}>{content}</h1>
          if (block.level === 2) return <h2 key={index}>{content}</h2>
          if (block.level === 3) return <h3 key={index}>{content}</h3>
          if (block.level === 4) return <h4 key={index}>{content}</h4>
          if (block.level === 5) return <h5 key={index}>{content}</h5>
          return <h6 key={index}>{content}</h6>
        }
        if (block.type === 'unordered-list' || block.type === 'ordered-list') {
          const List = block.type === 'unordered-list' ? 'ul' : 'ol'
          return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</List>
        }
        return <p key={index}>{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{inlineMarkdown(line)}</Fragment>)}</p>
      })}
    </div>
  )
}
