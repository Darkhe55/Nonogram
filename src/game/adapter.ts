/**
 * ════════════════════════════════════════════════════════════════════
 *  数织（Nonograms / Picross）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：根据每行、每列的数字线索涂黑格子；数字表示连续黑格的长度，
 * 组与组之间至少隔一格。
 *
 * 状态用 0/1/2：0 = 未定，1 = 黑，2 = 标记为空。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  BLACK,
  cluesFromSolution,
  decodeCells,
  decodeClues,
  encodeCells,
  encodeClues,
  MARK,
  type NonogramPuzzle,
} from './types'

const meta = {
  title: '数织',
  tagline: '按行列数字涂黑连续格子 —— 从线索里织出隐藏的图案',
  footerNote:
    '规则：每行左侧、每列上方的数字依次表示该行/列中各组连续黑格的长度，组与组之间至少隔一格。左键涂黑，再点标记为空。',
  storageKeyPrefix: 'nonogram',
  customIdPrefix: 'nonogram-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 60,
  customMaxH: 60,
}

const VALUE_CYCLE: Array<number | null> = [null, BLACK]

const custom: CustomSupport = {
  valueCycle: VALUE_CYCLE,

  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit === BLACK) return BLACK
    return undefined
  },

  cellLabel: (v) => (v === BLACK ? '■' : ''),

  cellClass: (v) => (v === BLACK ? 'v-black' : ''),

  hint: '在自定义题板里画出答案图案（点格子涂黑），载入后会自动生成行列线索。',

  toGrid: (p) => {
    const solution = (p as NonogramPuzzle).solution
    if (!Array.isArray(solution) || solution.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: solution.map((v) => (v === BLACK ? BLACK : null)),
    }
  },

  makePuzzle: (w, h, grid, existingId) => {
    const picture = grid.map((v) => (v === BLACK ? BLACK : 0))
    const clues = cluesFromSolution(picture, w, h)
    const solution = picture.map((v) => (v === BLACK ? BLACK : MARK))
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      rowClues: clues.rows,
      colClues: clues.cols,
      solution,
    } satisfies NonogramPuzzle
  },

  encodePuzzle: (p) => {
    const np = p as NonogramPuzzle
    const solution = np.solution ?? []
    return {
      board: encodeClues(np.rowClues ?? [], np.colClues ?? []),
      solution: encodeCells(solution),
    }
  },

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    if (typeof record.board !== 'string') return null
    const decoded = decodeClues(record.board, h, w)
    if (!decoded) return null
    let solution: number[] | undefined
    if (typeof record.solution === 'string') {
      const cells = decodeCells(record.solution, w * h)
      if (cells) solution = cells
    }
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      rowClues: decoded.rows,
      colClues: decoded.cols,
      solution,
    } satisfies NonogramPuzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.to === BLACK) playPluck(streak, 1.08)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
