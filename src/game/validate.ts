/**
 * 数织 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { lineFeasible, runsMatch } from './rules'
import {
  asNonogramPuzzle,
  asNonogramState,
  EMPTY,
  BLACK,
  type LineIssue,
  type NonogramResult,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): NonogramResult {
  const s = asNonogramState(state)
  const p = asNonogramPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const rowClues = p.rowClues ?? []
  const colClues = p.colClues ?? []

  let empty = 0
  let blackCount = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    else if (cells[i] === BLACK) blackCount++
  }

  const bad = new Set<number>()
  const lineIssues: LineIssue[] = []

  for (let y = 0; y < h; y++) {
    const line: number[] = []
    for (let x = 0; x < w; x++) line.push(cells[y * w + x]!)
    if (!lineFeasible(rowClues[y] ?? [], line, w)) {
      lineIssues.push({ orientation: 'row', index: y, clues: rowClues[y] ?? [] })
      for (let x = 0; x < w; x++) bad.add(y * w + x)
    }
  }

  for (let x = 0; x < w; x++) {
    const line: number[] = []
    for (let y = 0; y < h; y++) line.push(cells[y * w + x]!)
    if (!lineFeasible(colClues[x] ?? [], line, h)) {
      lineIssues.push({ orientation: 'col', index: x, clues: colClues[x] ?? [] })
      for (let y = 0; y < h; y++) bad.add(y * w + x)
    }
  }

  const solved = lineIssues.length === 0 && runsMatch(cells, rowClues, colClues, w, h)

  return {
    solved,
    empty,
    complete: empty === 0,
    blackCount,
    lineIssues,
    badCells: Array.from(bad),
    changedGivens: [],
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as NonogramResult
  if (r.solved) return ['完成']

  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.lineIssues.length > 0) {
    const rows = r.lineIssues.filter((x) => x.orientation === 'row').length
    const cols = r.lineIssues.length - rows
    if (rows > 0) bits.push(`${rows} 行线索无法满足`)
    if (cols > 0) bits.push(`${cols} 列线索无法满足`)
  }
  if (bits.length === 0) {
    if (r.blackCount === 0) bits.push('按行列线索开始涂黑')
    else bits.push('继续推理')
  }
  return bits
}
