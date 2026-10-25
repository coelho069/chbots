import { describe, expect, it } from 'vitest'
import { undoableReducer, type UndoableState } from '../src/renderer/src/flows/useUndoable'

function make<T>(initial: T): UndoableState<T> {
  return { past: [], present: initial, future: [] }
}

describe('undoableReducer', () => {
  it('set substitui o presente e limpa o futuro', () => {
    const s0 = make(1)
    const s1 = undoableReducer(s0, { type: 'set', value: 2 })
    expect(s1.present).toBe(2)
    expect(s1.past).toEqual([1])
    expect(s1.future).toEqual([])
  })

  it('undo restaura o estado anterior', () => {
    const s0 = make(1)
    const s1 = undoableReducer(s0, { type: 'set', value: 2 })
    const s2 = undoableReducer(s1, { type: 'undo' })
    expect(s2.present).toBe(1)
    expect(s2.past).toEqual([])
    expect(s2.future).toEqual([2])
  })

  it('redo restaura o estado desfeito', () => {
    const s0 = make(1)
    const s1 = undoableReducer(s0, { type: 'set', value: 2 })
    const s2 = undoableReducer(s1, { type: 'undo' })
    const s3 = undoableReducer(s2, { type: 'redo' })
    expect(s3.present).toBe(2)
    expect(s3.past).toEqual([1])
    expect(s3.future).toEqual([])
  })

  it('undo sem histórico não altera o estado', () => {
    const s0 = make('a')
    const s1 = undoableReducer(s0, { type: 'undo' })
    expect(s1).toEqual(s0)
  })

  it('redo sem futuro não altera o estado', () => {
    const s0 = make('a')
    const s1 = undoableReducer(s0, { type: 'redo' })
    expect(s1).toEqual(s0)
  })

  it('set após undo descarta o futuro', () => {
    const s0 = make(1)
    const s1 = undoableReducer(s0, { type: 'set', value: 2 })
    const s2 = undoableReducer(s1, { type: 'undo' })
    const s3 = undoableReducer(s2, { type: 'set', value: 3 })
    expect(s3.present).toBe(3)
    expect(s3.past).toEqual([1])
    expect(s3.future).toEqual([])
  })

  it('sequência múltipla de set/undo/redo funciona corretamente', () => {
    let s = make(0)
    s = undoableReducer(s, { type: 'set', value: 1 })
    s = undoableReducer(s, { type: 'set', value: 2 })
    s = undoableReducer(s, { type: 'set', value: 3 })
    // undo duas vezes
    s = undoableReducer(s, { type: 'undo' })
    s = undoableReducer(s, { type: 'undo' })
    expect(s.present).toBe(1)
    // redo uma vez
    s = undoableReducer(s, { type: 'redo' })
    expect(s.present).toBe(2)
  })

  it('reset define o presente sem histórico', () => {
    const s0 = make(1)
    const s1 = undoableReducer(s0, { type: 'set', value: 2 })
    const s2 = undoableReducer(s1, { type: 'reset', value: 99 })
    expect(s2.present).toBe(99)
    expect(s2.past).toEqual([])
    expect(s2.future).toEqual([])
  })
})
