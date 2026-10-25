import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks } from '../src/renderer/src/components/MarkdownContent'

describe('renderizador Markdown do chat', () => {
  it('reconhece títulos, listas e código cercado com linguagem', () => {
    expect(parseMarkdownBlocks('# Título\n\n- um\n- dois\n\n```ts\nconst x = 1\n```')).toEqual([
      { type: 'heading', level: 1, content: 'Título' },
      { type: 'unordered-list', items: ['um', 'dois'] },
      { type: 'code', language: 'ts', content: 'const x = 1' },
    ])
  })

  it('preserva texto simples e quebras de linha em parágrafos', () => {
    expect(parseMarkdownBlocks('linha 1\nlinha 2')).toEqual([
      { type: 'paragraph', lines: ['linha 1', 'linha 2'] },
    ])
  })

  it('mantém conteúdo fenced sem interpretar HTML', () => {
    expect(parseMarkdownBlocks('```html\n<script>alert(1)</script>\n```')[0]).toEqual({
      type: 'code', language: 'html', content: '<script>alert(1)</script>',
    })
  })
})
