import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderFileName, resolveInside, createSaveMarkdown } from '../src/main/flows/actions'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('actions', () => {
  describe('renderFileName', () => {
    it('substitui {fluxo} e {data} no template', () => {
      const date = new Date('2026-01-15T14:30:00')
      const result = renderFileName('{fluxo}-{data}.md', 'aprovacao', date)
      expect(result).toMatch(/^aprovacao-2026-01-15_\d{2}-\d{2}\.md$/)
      expect(result).toContain('aprovacao')
    })

    it('usa template padrão se vazio', () => {
      const date = new Date('2026-01-15T14:30:00')
      const result = renderFileName('', 'teste', date)
      expect(result).toMatch(/^teste-2026-01-15_\d{2}-\d{2}\.md$/)
    })

    it('remove caracteres Windows inválidos', () => {
      const date = new Date('2026-01-15T14:30:00')
      const result = renderFileName('{fluxo}-<inválido|>.md', 'teste', date)
      expect(result).not.toMatch(/[<>:"|\\?*]/)
      expect(result).toMatch(/\.md$/)
    })

    it('adiciona .md se não tiver extensão', () => {
      const date = new Date('2026-01-15T14:30:00')
      const result = renderFileName('{fluxo}-{data}', 'teste', date)
      expect(result).toMatch(/\.md$/)
    })

    it('trunca nome muito longo (máx 150 chars)', () => {
      const date = new Date('2026-01-15T14:30:00')
      const longName = 'a'.repeat(200) + '-{fluxo}-{data}'
      const result = renderFileName(longName, 'teste', date)
      expect(result.length).toBeLessThanOrEqual(154) // 150 + ".md"
    })
  })

  describe('resolveInside', () => {
    const folder = 'C:\\Users\\Test\\Documents'

    it('aceita arquivo válido dentro da pasta', () => {
      const result = resolveInside(folder, 'documento.md')
      expect(result).toMatch(/documento\.md$/)
    })

    it('rejeita path traversal com ..', () => {
      expect(() => resolveInside(folder, '../../../etc/passwd')).toThrow('Nome de arquivo inválido')
    })

    it('rejeita path traversal com caminho absoluto', () => {
      expect(() => resolveInside(folder, 'C:\\Windows\\system32.txt')).toThrow('Nome de arquivo inválido')
    })

    it('rejeita subpastas (barra no nome)', () => {
      expect(() => resolveInside(folder, 'subfolder\\arquivo.md')).toThrow('Nome de arquivo inválido')
    })
  })

  describe('createSaveMarkdown', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = join(tmpdir(), `flow-test-${Date.now()}`)
      await fs.mkdir(testDir, { recursive: true })
    })

    it('salva arquivo markdown com timestamp', async () => {
      const save = createSaveMarkdown(testDir, () => new Date('2026-01-15T14:30:45'))
      const result = await save({
        folder: testDir,
        fileName: '{fluxo}-{data}.md',
        content: '# Teste\n\nConteúdo do fluxo',
        flowName: 'teste'
      })

      const content = await fs.readFile(result, 'utf8')
      expect(content).toBe('# Teste\n\nConteúdo do fluxo')
      expect(result).toMatch(/teste-2026-01-15_\d{2}-\d{2}.*\.md$/)
    })

    it('evita sobrescrita com sufixo -2, -3, etc', async () => {
      const save = createSaveMarkdown(testDir, () => new Date('2026-01-15T14:30:00'))

      const path1 = await save({
        folder: testDir,
        fileName: 'fluxo-{data}.md',
        content: 'primeira',
        flowName: 'teste'
      })

      const path2 = await save({
        folder: testDir,
        fileName: 'fluxo-{data}.md',
        content: 'segunda',
        flowName: 'teste'
      })

      expect(path1).not.toBe(path2)
      expect(path2).toMatch(/-2\.md$/)

      const c1 = await fs.readFile(path1, 'utf8')
      const c2 = await fs.readFile(path2, 'utf8')
      expect(c1).toBe('primeira')
      expect(c2).toBe('segunda')
    })

    it('cria pasta se não existir', async () => {
      const nested = join(testDir, 'subpasta', 'aninhada')
      const save = createSaveMarkdown(nested, () => new Date('2026-01-15T14:30:00'))

      const result = await save({
        folder: nested,
        fileName: 'teste-{data}.md',
        content: 'conteúdo',
        flowName: 'fluxo'
      })

      expect(result).toBeTruthy()
      const content = await fs.readFile(result, 'utf8')
      expect(content).toBe('conteúdo')
    })

    it('usa pasta padrão se vazia', async () => {
      const save = createSaveMarkdown(testDir, () => new Date('2026-01-15T14:30:00'))

      const result = await save({
        folder: '',
        fileName: 'teste-{data}.md',
        content: 'padrão',
        flowName: 'fluxo'
      })

      expect(result).toContain(testDir)
      const content = await fs.readFile(result, 'utf8')
      expect(content).toBe('padrão')
    })
  })
})
