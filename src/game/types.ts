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

/* ────────────────────────── 棋盘留白 ────────────────────────── */

/**
 * 棋盘格宽（与 render.ts 保持一致）。
 * 老内核的 BoardMetrics 只有单一 pad，行列线索同时挤在这块留白里，
 * 所以这里的 pad 取「行线索所需宽度」与「列线索所需高度」的较大者。
 */
export const NONOGRAM_CELL = 44
/** 小盘面的基准留白（保持旧外观不变） */
export const NONOGRAM_MIN_PAD = 88

/** 单个数字字符的估算宽度（字号 = 0.3 × 格宽） */
const CLUE_FONT = NONOGRAM_CELL * 0.3
const CLUE_DIGIT_W = CLUE_FONT * 0.58
const CLUE_SPACE_W = CLUE_FONT * 0.3
/** 列线索每行间距（与 render.ts 的 lineHeight 一致） */
const CLUE_LINE_H = NONOGRAM_CELL * 0.32

/**
 * 计算棋盘留白：保证任意尺寸 / 任意线索数量下，行线索不会向左溢出、
 * 列线索不会向上溢出。小盘面结果等于 NONOGRAM_MIN_PAD（旧外观完全不变）。
 */
export function cluePadding(rowClues: number[][], colClues: number[][]): number {
  let maxRowWidth = 0
  for (const runs of rowClues) {
    let w = 0
    if (!runs || runs.length === 0) {
      w = CLUE_DIGIT_W
    } else {
      for (let k = 0; k < runs.length; k++) {
        if (k > 0) w += CLUE_SPACE_W
        w += String(runs[k]).length * CLUE_DIGIT_W
      }
    }
    if (w > maxRowWidth) maxRowWidth = w
  }
  let maxRuns = 0
  for (const runs of colClues) {
    if (runs && runs.length > maxRuns) maxRuns = runs.length
  }
  // 行线索文字右对齐在 pad-10 处，左侧再留 10px 边距
  const padLeft = Math.ceil(maxRowWidth + 20)
  // 列线索最上面一行的基线在 pad-10-(maxRuns-1)*lineH，上方留出字高与边距
  const padTop =
    maxRuns <= 0 ? 0 : Math.ceil(10 + (maxRuns - 1) * CLUE_LINE_H + CLUE_FONT + 8)
  return Math.max(NONOGRAM_MIN_PAD, padLeft, padTop)
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
