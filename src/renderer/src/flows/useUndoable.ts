import { useCallback, useReducer } from 'react'

export interface UndoableState<T> {
  past: T[]
  present: T
  future: T[]
}

type UndoableAction<T> =
  | { type: 'set'; value: T }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T }

export function undoableReducer<T>(state: UndoableState<T>, action: UndoableAction<T>): UndoableState<T> {
  switch (action.type) {
    case 'set':
      return { past: [...state.past, state.present], present: action.value, future: [] }
    case 'undo': {
      if (state.past.length === 0) return state
      const past = state.past.slice(0, -1)
      const present = state.past[state.past.length - 1]!
      return { past, present, future: [state.present, ...state.future] }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const [present, ...future] = state.future
      return { past: [...state.past, state.present], present: present!, future }
    }
    case 'reset':
      return { past: [], present: action.value, future: [] }
  }
}

function init<T>(initial: T): UndoableState<T> {
  return { past: [], present: initial, future: [] }
}

export function useUndoable<T>(initial: T): [T, (value: T) => void, () => void, () => void, boolean, boolean] {
  const [state, dispatch] = useReducer(
    (s: UndoableState<T>, a: UndoableAction<T>) => undoableReducer(s, a),
    initial,
    init
  )

  const set = useCallback((value: T) => dispatch({ type: 'set', value }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])

  return [state.present, set, undo, redo, state.past.length > 0, state.future.length > 0]
}

export function resetUndoable<T>(dispatch: React.Dispatch<UndoableAction<T>>, value: T): void {
  dispatch({ type: 'reset', value })
}
