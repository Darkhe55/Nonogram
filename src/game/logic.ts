/**
 * 数织 —— 逻辑解题回放计划
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { isValidSolution, propagate, type RuleKind } from './rules'
import {
  asNonogramPuzzle,
  asNonogramState,
  BLACK,
  EMPTY,
  MARK,
  type NonogramState,
} from './types'

const RULE_INFO: Record<RuleKind | 'probe' | 'search', { rule: number; label: string }> = {
  line: { rule: 1, label: '行列线索决定了这一格' },
  probe: { rule: 2, label: '反证：另一种涂法会立刻矛盾' },
  search: { rule: 3, label: '回溯试探：该格最终是这一状态' },
}

function fallbackSolve(
  grid: number[],
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
  maxNodes: number,
): number[] | null {
  const size = w * h
  let nodes = 0
  let timedOut = false
  const work = grid.slice()

  const dfs = (): number[] | null => {
    if (timedOut) return null
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return null
    }
    if (!propagate(work, rowClues, colClues, w, h)) return null

    let choice = -1
    for (let i = 0; i < size; i++) {
      if (work[i] === EMPTY) {
        choice = i
        break
      }
    }
    if (choice < 0) {
      return isValidSolution(work, rowClues, colClues, w, h) ? Array.from(work) : null
    }

    const backup = work.slice()
    for (const value of [BLACK, MARK] as const) {
      work[choice] = value
      const found = dfs()
      if (found) return found
      for (let i = 0; i < size; i++) work[i] = backup[i]!
      if (timedOut) return null
    }
    return null
  }

  return dfs()
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asNonogramPuzzle(puzzle)
  const s = asNonogramState(initialState)
  const w = s.width
  const h = s.height
  const size = w * h
  const rowClues = p.rowClues ?? []
  const colClues = p.colClues ?? []

  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }
  if (rowClues.length !== h || colClues.length !== w) return emptyPlan

  const grid = s.cells.slice()
  const displayed = s.cells.slice()
  const frames: PlaybackFrame[] = []
  let lastKind = ''
  let streak = 0

  const emit = (index: number, to: number, kind: RuleKind | 'probe' | 'search'): void => {
    const from = displayed[index] ?? EMPTY
    if (from === to) return
    displayed[index] = to
    if (kind === lastKind) streak++
    else {
      lastKind = kind
      streak = 1
    }
    const info = RULE_INFO[kind]
    frames.push({ rule: info.rule, label: info.label, move: { index, from, to }, streak })
  }

  const onSet = (index: number, value: number, kind: RuleKind): void => {
    emit(index, value, kind)
  }

  if (!propagate(grid, rowClues, colClues, w, h, onSet)) return emptyPlan

  let saturated = true
  for (let round = 0; round < size * 2; round++) {
    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) break
    if (frames.length > 8000) {
      saturated = false
      break
    }

    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let blackImpossible = false
      let markImpossible = false
      {
        const trial = grid.slice()
        trial[i] = BLACK
        if (!propagate(trial, rowClues, colClues, w, h)) blackImpossible = true
      }
      {
        const trial = grid.slice()
        trial[i] = MARK
        if (!propagate(trial, rowClues, colClues, w, h)) markImpossible = true
      }
      if (blackImpossible && markImpossible) return emptyPlan
      if (blackImpossible !== markImpossible) {
        forced.push({ index: i, value: blackImpossible ? MARK : BLACK })
      }
    }

    if (!forced.length) {
      saturated = false
      break
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) {
        grid[index] = value
        emit(index, value, 'probe')
      }
    }
    if (!propagate(grid, rowClues, colClues, w, h, onSet)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === EMPTY) {
      stillUnknown = true
      break
    }
  }

  if (stillUnknown) {
    const found = fallbackSolve(grid, rowClues, colClues, w, h, 800_000)
    if (!found) return emptyPlan
    for (let i = 0; i < size; i++) {
      if (grid[i] === found[i]) continue
      grid[i] = found[i]!
      emit(i, found[i]!, 'search')
    }
    saturated = false
  }

  const finalState: NonogramState = {
    puzzleId: s.puzzleId,
    width: w,
    height: h,
    cells: Array.from(grid),
    givens: s.givens.slice(),
  }

  return {
    puzzleId: p.id,
    frames,
    finalState,
    ruleSteps: frames.length,
    saturated,
  }
}
