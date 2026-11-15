/**
 * 数织（Nonograms / Picross）—— 游戏专用类型
 *
 * 规则：根据每行、每列的数字线索涂黑格子；数字依次表示该行/列中
 * 各组连续黑格的长度，组与组之间至少隔一格。
 *
 * 状态：0 = 未定，1 = 黑格，2 = 标记为空（×）。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const BLACK = 1
export const MARK = 2

export type CellValue = 0 | 1 | 2

export interface NonogramPuzzle extends Puzzle {
  rowClues: number[][]
  colClues: number[][]
  /** 参考解：1 黑 / 2 非黑 */
  solution?: number[]
}

export interface NonogramState extends GameState {
  cells: number[]
  givens: number[]
}

export interface LineIssue {
  orientation: 'row' | 'col'
  index: number
  clues: number[]
}

export interface NonogramResult extends ValidationResult {
  empty: number
  complete: boolean
  blackCount: number
  lineIssues: LineIssue[]
  badCells: number[]
  changedGivens: number[]
}

export function asNonogramPuzzle(p: Puzzle): NonogramPuzzle {
  return p as NonogramPuzzle
}

export function asNonogramState(s: GameState): NonogramState {
  return s as NonogramState
}

/* ────────────────────────── 线索编码 ────────────────────────── */

/**
 * board = 行线索 + "|" + 列线索
 * 每行线索：数字用逗号分隔，空行写作空串；行与行用分号分隔。
 */
export function encodeClues(rows: number[][], cols: number[][]): string {
  const side = (lines: number[][]) => lines.map((runs) => runs.join(',')).join(';')
  return `${side(rows)}|${side(cols)}`
}

function parseSide(text: string): number[][] | null {
  const lines = text.split(';')
  const out: number[][] = []
  for (const line of lines) {
    if (line === '') {
      out.push([])
      continue
    }
    const runs: number[] = []
    for (const part of line.split(',')) {
      const n = Number(part)
      if (!Number.isInteger(n) || n <= 0) return null
      runs.push(n)
    }
    out.push(runs)
  }
  return out
}

export function decodeClues(
  text: string,
  expectedRows: number,
  expectedCols: number,
): { rows: number[][]; cols: number[][] } | null {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 2) return null
  const rows = parseSide(parts[0]!)
  const cols = parseSide(parts[1]!)
  if (!rows || !cols) return null
  if (rows.length !== expectedRows || cols.length !== expectedCols) return null
  return { rows, cols }
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'B' || ch === 'b' || ch === '#') out[i] = BLACK
    else if (ch === '2' || ch === 'X' || ch === 'x' || ch === '-') out[i] = MARK
    else return null
  }
  return out
}

/** 从完整图案推导行列线索 */
export function cluesFromSolution(
  cells: ArrayLike<number>,
  w: number,
  h: number,
): { rows: number[][]; cols: number[][] } {
  const runsOf = (line: ArrayLike<number>): number[] => {
    const runs: number[] = []
    let cur = 0
    for (let i = 0; i < line.length; i++) {
      if (line[i] === BLACK || line[i] === 1) {
        cur++
      } else if (cur > 0) {
        runs.push(cur)
        cur = 0
      }
    }
    if (cur > 0) runs.push(cur)
    return runs
  }
  const rows: number[][] = []
  for (let y = 0; y < h; y++) {
    const line: number[] = []
    for (let x = 0; x < w; x++) line.push(cells[y * w + x] ?? 0)
    rows.push(runsOf(line))
  }
  const cols: number[][] = []
  for (let x = 0; x < w; x++) {
    const line: number[] = []
    for (let y = 0; y < h; y++) line.push(cells[y * w + x] ?? 0)
    cols.push(runsOf(line))
  }
  return { rows, cols }
}
