/**
 * 数织 —— 规则引擎
 *
 * 每一行/列的数字线索固定了连续黑格的组数与长度。
 * 传播方式：枚举该行/列所有符合线索与当前状态的排布，
 * 若某个格子在所有排布中取值相同，就可以确定它。
 */

import { BLACK, EMPTY, MARK } from './types.ts'

export type RuleKind = 'line'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

export interface ClueSource {
  rowClues: number[][]
  colClues: number[][]
}

/** 枚举一条线的全部合法排布（1 = 黑，2 = 非黑）；无解返回 [] */
export function enumerateLine(
  clues: number[],
  line: ArrayLike<number>,
  length: number,
): number[][] {
  const out = new Array<number>(length).fill(MARK)
  const results: number[][] = []

  const rec = (runIndex: number, start: number): void => {
    if (runIndex === clues.length) {
      for (let i = start; i < length; i++) if (line[i] === BLACK) return
      results.push(out.slice())
      return
    }

    const run = clues[runIndex]!
    const restRuns = clues.length - runIndex - 1
    let restSum = 0
    for (let k = runIndex + 1; k < clues.length; k++) restSum += clues[k]!
    const need = restRuns > 0 ? restSum + restRuns : 0
    const maxStart = length - run - need

    for (let s = start; s <= maxStart; s++) {
      // start 之前的格子必须是空的
      let ok = true
      for (let i = start; i < s; i++) {
        if (line[i] === BLACK) {
          ok = false
          break
        }
      }
      if (!ok) break

      // 组内不能有已标记的空格
      for (let i = s; i < s + run; i++) {
        if (line[i] === MARK) {
          ok = false
          break
        }
      }
      if (!ok) continue

      for (let i = s; i < s + run; i++) out[i] = BLACK

      let nextPos = s + run
      if (runIndex + 1 < clues.length) {
        if (nextPos < length && line[nextPos] === BLACK) {
          for (let i = s; i < s + run; i++) out[i] = MARK
          continue
        }
        nextPos++
      }

      rec(runIndex + 1, nextPos)

      for (let i = s; i < s + run; i++) out[i] = MARK
    }
  }

  rec(0, 0)
  return results
}

export function propagate(
  cells: number[],
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  let changed = true

  const apply = (indices: number[], placements: number[][]): boolean => {
    if (placements.length === 0) return false
    for (let k = 0; k < indices.length; k++) {
      const value = placements[0]![k]!
      let same = true
      for (let p = 1; p < placements.length; p++) {
        if (placements[p]![k] !== value) {
          same = false
          break
        }
      }
      if (!same) continue
      const index = indices[k]!
      if (cells[index] === EMPTY) {
        cells[index] = value
        onSet?.(index, value, 'line')
        changed = true
      }
    }
    return true
  }

  while (changed) {
    changed = false

    for (let y = 0; y < h; y++) {
      const indices: number[] = []
      const line: number[] = []
      for (let x = 0; x < w; x++) {
        indices.push(y * w + x)
        line.push(cells[y * w + x]!)
      }
      const placements = enumerateLine(rowClues[y] ?? [], line, w)
      if (!apply(indices, placements)) return false
    }

    for (let x = 0; x < w; x++) {
      const indices: number[] = []
      const line: number[] = []
      for (let y = 0; y < h; y++) {
        indices.push(y * w + x)
        line.push(cells[y * w + x]!)
      }
      const placements = enumerateLine(colClues[x] ?? [], line, h)
      if (!apply(indices, placements)) return false
    }
  }

  return true
}

/** 当前黑格的实际分组长度 */
export function runsOf(cells: ArrayLike<number>, indices: number[]): number[] {
  const runs: number[] = []
  let cur = 0
  for (const i of indices) {
    if (cells[i] === BLACK) {
      cur++
    } else if (cur > 0) {
      runs.push(cur)
      cur = 0
    }
  }
  if (cur > 0) runs.push(cur)
  return runs
}

function sameRuns(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
): boolean {
  for (let i = 0; i < w * h; i++) {
    if (cells[i] !== BLACK && cells[i] !== MARK) return false
  }
  for (let y = 0; y < h; y++) {
    const indices: number[] = []
    for (let x = 0; x < w; x++) indices.push(y * w + x)
    if (!sameRuns(runsOf(cells, indices), rowClues[y] ?? [])) return false
  }
  for (let x = 0; x < w; x++) {
    const indices: number[] = []
    for (let y = 0; y < h; y++) indices.push(y * w + x)
    if (!sameRuns(runsOf(cells, indices), colClues[x] ?? [])) return false
  }
  return true
}

/** 当前黑格分组是否已经满足线索（未定格视为非黑） */
export function runsMatch(
  cells: ArrayLike<number>,
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
): boolean {
  for (let y = 0; y < h; y++) {
    const indices: number[] = []
    for (let x = 0; x < w; x++) indices.push(y * w + x)
    if (!sameRuns(runsOf(cells, indices), rowClues[y] ?? [])) return false
  }
  for (let x = 0; x < w; x++) {
    const indices: number[] = []
    for (let y = 0; y < h; y++) indices.push(y * w + x)
    if (!sameRuns(runsOf(cells, indices), colClues[x] ?? [])) return false
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  rowClues: number[][],
  colClues: number[][],
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = new Array<number>(size).fill(EMPTY)
  let usedProbing = false

  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, rowClues, colClues, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }

    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, rowClues, colClues, w, h)
      return {
        ok,
        solution: ok ? solution : null,
        contradiction: false,
        saturated: ok,
        usedProbing,
      }
    }

    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }

    usedProbing = true
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
      if (blackImpossible && markImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (blackImpossible !== markImpossible) {
        forced.push({ index: i, value: blackImpossible ? MARK : BLACK })
      }
    }

    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }

  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
