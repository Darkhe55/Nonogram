/**
 * 数织 —— 棋盘状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asNonogramPuzzle,
  asNonogramState,
  BLACK,
  decodeCells,
  EMPTY,
  encodeCells,
  MARK,
  type NonogramState,
} from './types'

export function createEmptyState(puzzle: Puzzle): NonogramState {
  const p = asNonogramPuzzle(puzzle)
  const size = p.width * p.height
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    cells: new Array<number>(size).fill(EMPTY),
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function cloneState(state: GameState): NonogramState {
  const s = asNonogramState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: s.cells.slice(),
    givens: s.givens.slice(),
  }
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asNonogramState(state)
  const v = s.cells[target.index] ?? EMPTY
  if (v === EMPTY) return BLACK
  if (v === BLACK) return MARK
  return EMPTY
}

export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asNonogramState(state)
  return s.cells[target.index] === MARK ? EMPTY : MARK
}

export function applyMove(state: GameState, move: Move): void {
  const s = asNonogramState(state)
  if (move.index < 0 || move.index >= s.cells.length) return
  s.cells[move.index] = move.to === BLACK || move.to === MARK ? move.to : EMPTY
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asNonogramState(state).cells[index] ?? EMPTY
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asNonogramState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
  }
}

function readCells(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (n !== EMPTY && n !== BLACK && n !== MARK) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): NonogramState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width
  const h = data.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  const size = w * h
  const cells = readCells(data.cells, size)
  if (!cells) return null
  return {
    puzzleId: data.puzzleId,
    width: w,
    height: h,
    cells,
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asNonogramState(state)
  const sol = asNonogramState(solution)
  const size = Math.min(s.cells.length, sol.cells.length)
  for (let i = 0; i < size; i++) {
    if (sol.cells[i] === BLACK && s.cells[i] !== BLACK) {
      return { index: i, from: s.cells[i]!, to: BLACK }
    }
  }
  for (let i = 0; i < size; i++) {
    if (sol.cells[i] !== BLACK && s.cells[i] === BLACK) {
      return { index: i, from: BLACK, to: MARK }
    }
  }
  return null
}
