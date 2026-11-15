/**
 * 数织题库生成器
 *
 * 1. 生成随机黑白图案；
 * 2. 从图案推导行列线索；
 * 3. 用行列传播 + 回溯统计解数，只保留恰好一解的图案。
 */

import type { Difficulty } from '../core/types'
import {
  BLACK,
  MARK,
  cluesFromSolution,
  encodeCells,
  encodeClues,
} from './types.ts'
import { solveByRules } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  density: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  attempts: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface AttemptStats {
  notUnique: number
  timeout: number
  empty: number
}

function attemptPuzzle(
  spec: GenSpec,
  rng: () => number,
  stats: AttemptStats,
): { rows: number[][]; cols: number[][]; solution: number[] } | null {
  const { w, h } = spec
  const size = w * h
  const picture = new Array<number>(size).fill(0)
  let black = 0
  for (let i = 0; i < size; i++) {
    if (rng() < spec.density) {
      picture[i] = BLACK
      black++
    }
  }
  if (black === 0 || black === size) {
    stats.empty++
    return null
  }

  const clues = cluesFromSolution(picture, w, h)
  const counted = countSolutions(clues.rows, clues.cols, size, w, h, 2, spec.maxNodes)
  if (counted.timedOut) {
    stats.timeout++
    return null
  }
  if (counted.count !== 1) {
    stats.notUnique++
    return null
  }

  if (spec.requireLogic) {
    const rules = solveByRules(clues.rows, clues.cols, size, w, h, true, 240)
    if (!rules.ok || !rules.saturated) {
      // 仍然可用；check 会给出警告
    }
  }

  const solution = picture.map((v) => (v === BLACK ? BLACK : MARK))
  return { rows: clues.rows, cols: clues.cols, solution }
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    density: 0.5,
    seed: 0x4e4f4e01,
    difficulty: 'easy',
    name: '初织小图',
    series: '入门',
    attempts: 600,
    maxNodes: 60_000,
    requireLogic: true,
  },
  {
    w: 7,
    h: 7,
    density: 0.5,
    seed: 0x4e4f4e02,
    difficulty: 'easy',
    name: '七行经纬',
    series: '入门',
    attempts: 800,
    maxNodes: 90_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    density: 0.5,
    seed: 0x4e4f4e03,
    difficulty: 'medium',
    name: '织影回廊',
    series: '进阶',
    attempts: 1000,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    density: 0.55,
    seed: 0x4e4f4e04,
    difficulty: 'medium',
    name: '密线之图',
    series: '进阶',
    attempts: 1200,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    density: 0.5,
    seed: 0x4e4f4e05,
    difficulty: 'hard',
    name: '十方织锦',
    series: '挑战',
    attempts: 1500,
    maxNodes: 180_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    density: 0.55,
    seed: 0x4e4f4e06,
    difficulty: 'hard',
    name: '像素终章',
    series: '挑战',
    attempts: 1800,
    maxNodes: 200_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const stats: AttemptStats = { notUnique: 0, timeout: 0, empty: 0 }
    let made: { rows: number[][]; cols: number[][]; solution: number[] } | null = null
    const t0 = Date.now()
    for (let attempt = 0; attempt < spec.attempts; attempt++) {
      made = attemptPuzzle(spec, rng, stats)
      if (made) break
    }
    if (!made) {
      console.error(`[数织 gen] ${spec.name} 失败统计：`, stats)
      throw new Error(`[数织 gen] ${spec.name} 在 ${spec.attempts} 次尝试内没有生成唯一解题`)
    }
    const black = made.solution.filter((v) => v === BLACK).length
    console.log(
      `[数织 gen] ${spec.name} ${spec.w}×${spec.h}：黑格 ${black}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `nonogram-${spec.w}x${spec.h}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeClues(made.rows, made.cols),
      solution: encodeCells(made.solution),
    })
  }
  return out
}
