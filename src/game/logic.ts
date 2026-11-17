/**
 * 数织 —— 逻辑解题回放计划
 *
 * 只做可证明的推理，不猜：
 *   R1 重叠必黑 / 必白        按线索可行区间求交并（与当前盘面无关的必然结论）
 *   R2 边缘线索 / 线索块边界  首格已黑 → 第一块贴行首；末格已黑 → 最后一块贴行尾；
 *                            线索最短总长 = 行长 → 满排唯一
 *   R3 行 / 列线索 DP 全解    对每条线做放置 DP，所有合法排布取值相同的格子直接确定
 *   R4 排布交叉一致           线级反证后若仍有多条排布能延续，它们共同的格子也可确定
 *   R5 线级反证               取候选排布最少的线逐排布整行试放，只剩一种能延续 → 必放
 *   R6 回溯试探               规则推不动时的兜底（按「候选排布最少的线」分支）
 *
 * R1–R3 是完整的单线推理（DP 不枚举具体排布），R4/R5 才需要跨线试探，
 * 且试探对象从「每个空格」压缩成「一条线的几种排布」。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import {
  analyzeLine,
  createPropagateStats,
  isValidSolution,
  linePlacements,
  probeLineLevel,
  propagate,
  type PropagateStats,
  type RuleKind,
} from './rules.ts'
import {
  asNonogramPuzzle,
  asNonogramState,
  BLACK,
  EMPTY,
  MARK,
  type NonogramState,
} from './types.ts'

const RULE_INFO: Record<
  RuleKind | 'cross' | 'probe' | 'search',
  { rule: number; label: string }
> = {
  overlap: { rule: 1, label: '重叠必黑 / 必白：线索可行区间交并决定了这一格' },
  edge: { rule: 2, label: '边缘线索 / 线索块边界强制' },
  line: { rule: 3, label: '行 / 列线索 DP 全解：所有合法排布都是这一状态' },
  cross: { rule: 4, label: '排布交叉一致：能延续的排布都取这一状态' },
  probe: { rule: 5, label: '线级反证：该行 / 列只剩一种能延续的排布' },
  search: { rule: 6, label: '回溯试探：该格最终是这一状态' },
}

/** 兜底搜索时一条线最多枚举多少种排布（超过则改为按格分支） */
const LINE_BRANCH_CAP = 2_000

interface LineBranch {
  indices: number[]
  clues: number[]
  length: number
  count: number
}

/**
 * 兜底回溯：优先按「候选排布最少的行/列」整行分支，比逐格分支窄得多。
 */
function fallbackSolve(
  grid: number[],
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
  maxNodes: number,
  stats: PropagateStats,
): number[] | null {
  const size = w * h
  const work = grid.slice()
  let nodes = 0
  let timedOut = false

  const lines: Array<{ indices: number[]; clues: number[]; length: number }> = []
  for (let y = 0; y < h; y++) {
    const indices: number[] = []
    for (let x = 0; x < w; x++) indices.push(y * w + x)
    lines.push({ indices, clues: rowClues[y] ?? [], length: w })
  }
  for (let x = 0; x < w; x++) {
    const indices: number[] = []
    for (let y = 0; y < h; y++) indices.push(y * w + x)
    lines.push({ indices, clues: colClues[x] ?? [], length: h })
  }

  const dfs = (): number[] | null => {
    if (timedOut) return null
    nodes++
    stats.searchNodes++
    if (nodes > maxNodes) {
      timedOut = true
      return null
    }
    if (!propagate(work, rowClues, colClues, w, h)) return null

    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (work[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      return isValidSolution(work, rowClues, colClues, w, h) ? work.slice() : null
    }

    let best: LineBranch | null = null
    for (const line of lines) {
      const values: number[] = []
      for (const i of line.indices) values.push(work[i]!)
      const info = analyzeLine(line.clues, values, line.length)
      if (!info.feasible) return null
      if (info.count <= 1) continue
      if (!best || info.count < best.count) {
        best = { indices: line.indices, clues: line.clues, length: line.length, count: info.count }
      }
    }

    if (best && best.count <= LINE_BRANCH_CAP) {
      const values: number[] = []
      for (const i of best.indices) values.push(work[i]!)
      const placements = linePlacements(best.clues, values, best.length, best.count)
      if (!placements.length) return null
      const backup = work.slice()
      for (const plan of placements) {
        for (let k = 0; k < best.indices.length; k++) work[best.indices[k]!] = plan[k]!
        const found = dfs()
        if (found) return found
        for (let i = 0; i < size; i++) work[i] = backup[i]!
        if (timedOut) return null
      }
      return null
    }

    // 候选排布过多：退化为单格分支
    const backup = work.slice()
    for (const value of [BLACK, MARK] as const) {
      work[unknown] = value
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

  const stats = createPropagateStats()
  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
    stats,
  }
  if (rowClues.length !== h || colClues.length !== w) return emptyPlan

  const grid = s.cells.slice()
  const displayed = s.cells.slice()
  const frames: PlaybackFrame[] = []
  let lastKind = ''
  let streak = 0

  const emit = (index: number, to: number, kind: RuleKind | 'cross' | 'probe' | 'search'): void => {
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

  if (!propagate(grid, rowClues, colClues, w, h, onSet, stats)) return emptyPlan

  let saturated = true
  for (let round = 0; round < size * 2 + 8; round++) {
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

    const outcome = probeLineLevel(
      grid,
      rowClues,
      colClues,
      w,
      h,
      (index, value, kind) => emit(index, value, kind),
      stats,
    )
    if (outcome === 'contradiction') return emptyPlan
    if (outcome === 'stuck') {
      saturated = false
      break
    }
    if (!propagate(grid, rowClues, colClues, w, h, onSet, stats)) return emptyPlan
  }

  let stillUnknown = false
  for (let i = 0; i < size; i++) {
    if (grid[i] === EMPTY) {
      stillUnknown = true
      break
    }
  }

  if (stillUnknown) {
    const found = fallbackSolve(grid, rowClues, colClues, w, h, 800_000, stats)
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
    stats,
  }
}
