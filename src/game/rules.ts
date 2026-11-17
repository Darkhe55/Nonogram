/**
 * 数织 —— 规则引擎
 *
 * 这里只放「可证明」的定式：每一步赋值都能由行列线索直接推出，不猜。
 * 回溯搜索（solver.ts / logic.ts 的兜底）只作为最后手段。
 *
 * 规则分类（同时用作逻辑回放的规则名）：
 *   overlap  重叠必黑 / 必白：按线索的可行区间求交并。每个线索块最早的起点
 *            （前面全部按最短排布）与最晚的起点（后面全部按最短排布）之间的重叠段
 *            必为黑格；任何线索块都覆盖不到的格子必为白格。
 *   edge     边缘线索 / 线索块边界强制：首格已黑 → 第一块必须从行首开始；
 *            末格已黑 → 最后一块必须贴行尾；线索最短总长恰好等于行长（满排）→
 *            整行排布唯一。
 *   line     行 / 列线索 DP 全解：对一条线做「线索块放置」DP（前后向可达性），
 *            所有合法排布在某格取值相同即可确定该格。这是完整的单线推理，
 *            不再枚举具体排布，复杂度只与 线索数 × 行长² 有关。
 *
 * 线级反证（logic.ts 使用）：当 DP 仍推不动时，取候选排布最少的行/列，
 * 对它的每种排布做一次整行传播；只剩一种能延续 → 该排布必在解中；
 * 多种能延续但它们在某格一致 → 该格也可确定。这比逐格反证强得多，
 * 也把反证次数从「每格两次」压到「每条线几种」。
 */

import { BLACK, EMPTY, MARK } from './types.ts'

export type RuleKind = 'overlap' | 'edge' | 'line'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

/** 传播期诊断计数（审计 / check 用，不影响推理结果） */
export interface PropagateStats {
  [key: string]: number
  /** 行 / 列线求解次数 */
  lineSolves: number
  /** DP 处理的状态数（DP 线解器开销指标） */
  dpStates: number
  /** 累计合法排布数（参考值；DP 只计数、不materialize） */
  placements: number
  /** 线级反证：试放的整行排布次数 */
  probes: number
  /** 交叉一致：多排布共同确定的格子数 */
  crossCommits: number
  /** 兜底回溯节点数 */
  searchNodes: number
}

export function createPropagateStats(): PropagateStats {
  return { lineSolves: 0, dpStates: 0, placements: 0, probes: 0, crossCommits: 0, searchNodes: 0 }
}

/* ────────────────────────── 单行 / 单列 DP ────────────────────────── */

interface LineDp {
  feasible: boolean
  /** 合法排布总数（封顶 cap + 1，避免大数溢出） */
  count: number
  /** 每格是否可能在某个合法排布里是黑格 */
  canBlack: Uint8Array
  /** 每格是否可能在某个合法排布里是白格 */
  canWhite: Uint8Array
  /** 前向可达：fwd[k][pos] = 前 k 块已放好，下一块可以从 pos 起放 */
  fwd: Uint8Array[]
  /** 后向可达：bwd[k][pos] = 第 k.. 块能从 pos 起放完 */
  bwd: Uint8Array[]
  clues: number[]
  length: number
}

function buildLineDp(
  clues: number[],
  line: ArrayLike<number>,
  length: number,
  cap = 1_000_000,
): LineDp {
  const runs = clues.length
  const nextBlack = new Int32Array(length + 1)
  const nextMark = new Int32Array(length + 1)
  nextBlack[length] = length
  nextMark[length] = length
  for (let i = length - 1; i >= 0; i--) {
    nextBlack[i] = line[i] === BLACK ? i : nextBlack[i + 1]!
    nextMark[i] = line[i] === MARK ? i : nextMark[i + 1]!
  }

  // restAfter[k] = sum_{i>=k} (clues[i] + 1)
  const restAfter = new Int32Array(runs + 1)
  for (let k = runs - 1; k >= 0; k--) restAfter[k] = restAfter[k + 1]! + clues[k]! + 1

  const maxStartOf = (k: number): number => length - clues[k]! - restAfter[k + 1]!

  /** 枚举第 k 块所有可能起点（满足与 pos 之间的白格 / 块内无白格 / 分隔约束） */
  const forEachStart = (
    k: number,
    pos: number,
    cb: (start: number, nextPos: number) => void,
  ): void => {
    const len = clues[k]!
    const last = k + 1 === runs
    const hi = maxStartOf(k)
    if (pos > hi) return
    for (let s = pos; s <= hi; s++) {
      if (s > pos && line[s - 1] === BLACK) break // [pos, s) 里出现黑格：更靠后的起点也不行
      if (nextMark[s]! < s + len) continue // 块内碰到已标白格
      if (last) {
        const end = s + len
        if (nextBlack[end]! < length) continue // 块后还有黑格 → 多出一块
        cb(s, end)
      } else {
        const sep = s + len
        if (sep >= length) continue
        if (line[sep] === BLACK) continue // 分隔格已黑
        cb(s, sep + 1)
      }
    }
  }

  const bwd: Uint8Array[] = Array.from({ length: runs + 1 }, () => new Uint8Array(length + 1))
  for (let pos = 0; pos <= length; pos++) bwd[runs]![pos] = nextBlack[pos]! >= length ? 1 : 0
  for (let k = runs - 1; k >= 0; k--) {
    const cur = bwd[k]!
    const next = bwd[k + 1]!
    for (let pos = 0; pos <= length; pos++) {
      let ok = 0
      forEachStart(k, pos, (_s, nextPos) => {
        if (next[nextPos]) ok = 1
      })
      cur[pos] = ok
    }
  }

  const fwd: Uint8Array[] = Array.from({ length: runs + 1 }, () => new Uint8Array(length + 1))
  fwd[0]![0] = 1
  const ways: Float64Array[] = Array.from({ length: runs + 1 }, () => new Float64Array(length + 1))
  ways[0]![0] = 1
  let count = 0
  for (let k = 0; k < runs; k++) {
    const curF = fwd[k]!
    const curW = ways[k]!
    const nextF = fwd[k + 1]!
    const nextW = ways[k + 1]!
    for (let pos = 0; pos <= length; pos++) {
      if (!curF[pos]) continue
      const w = curW[pos]!
      forEachStart(k, pos, (_s, nextPos) => {
        nextF[nextPos] = 1
        if (w > 0) nextW[nextPos] = Math.min(cap + 1, nextW[nextPos]! + w)
      })
    }
  }
  for (let pos = 0; pos <= length; pos++) {
    if (fwd[runs]![pos]) count += ways[runs]![pos]!
  }
  if (runs === 0) count = bwd[0]![0] ? 1 : 0
  count = Math.min(count, cap + 1)

  const canBlack = new Uint8Array(length)
  const canWhite = new Uint8Array(length)
  // 每个「左可达 + 右可续」的转移都出现在至少一个合法排布里
  for (let k = 0; k < runs; k++) {
    const curF = fwd[k]!
    const next = bwd[k + 1]!
    const len = clues[k]!
    const last = k + 1 === runs
    for (let pos = 0; pos <= length; pos++) {
      if (!curF[pos]) continue
      forEachStart(k, pos, (s, nextPos) => {
        if (!next[nextPos]) return
        for (let i = s; i < s + len; i++) canBlack[i] = 1
        for (let i = pos; i < s; i++) canWhite[i] = 1
        if (!last) canWhite[s + len] = 1
      })
    }
  }
  for (let pos = 0; pos <= length; pos++) {
    if (!fwd[runs]![pos]) continue
    for (let i = pos; i < length; i++) canWhite[i] = 1
  }

  return { feasible: count > 0, count, canBlack, canWhite, fwd, bwd, clues, length }
}

/** 一条线的完整分析：合法排布数 + 每格能否为黑/白 */
export function analyzeLine(
  clues: number[],
  line: ArrayLike<number>,
  length: number,
): { feasible: boolean; count: number; canBlack: Uint8Array; canWhite: Uint8Array } {
  const dp = buildLineDp(clues, line, length)
  return { feasible: dp.feasible, count: dp.count, canBlack: dp.canBlack, canWhite: dp.canWhite }
}

/** 一条线是否还存在合法排布（校验器用；等价于旧 enumerateLine().length > 0） */
export function lineFeasible(clues: number[], line: ArrayLike<number>, length: number): boolean {
  return buildLineDp(clues, line, length).feasible
}

/** 枚举一条线最多 limit 种合法排布（自动按 DP 可达性剪枝） */
export function linePlacements(
  clues: number[],
  line: ArrayLike<number>,
  length: number,
  limit: number,
): number[][] {
  if (limit <= 0) return []
  const dp = buildLineDp(clues, line, length, Math.max(limit, 2))
  const out: number[][] = []
  if (!dp.feasible) return out
  const runs = clues.length
  if (runs === 0) {
    out.push(new Array<number>(length).fill(MARK))
    return out
  }
  const buf = new Array<number>(length).fill(MARK)
  const rec = (k: number, pos: number): void => {
    if (out.length >= limit) return
    if (k === runs) {
      out.push(buf.slice())
      return
    }
    const next = dp.bwd[k + 1]!
    const len = clues[k]!
    const last = k + 1 === runs
    for (let s = pos; s + len <= length; s++) {
      if (s > pos && line[s - 1] === BLACK) break
      let runOk = true
      for (let i = s; i < s + len; i++) {
        if (line[i] === MARK) {
          runOk = false
          break
        }
      }
      if (!runOk) continue
      let nextPos: number
      if (last) {
        const end = s + len
        let tailOk = true
        for (let i = end; i < length; i++) {
          if (line[i] === BLACK) {
            tailOk = false
            break
          }
        }
        if (!tailOk) continue
        nextPos = end
      } else {
        const sep = s + len
        if (sep >= length || line[sep] === BLACK) continue
        nextPos = sep + 1
      }
      if (!next[nextPos]) continue
      for (let i = s; i < s + len; i++) buf[i] = BLACK
      rec(k + 1, nextPos)
      for (let i = s; i < s + len; i++) buf[i] = MARK
      if (out.length >= limit) return
    }
  }
  rec(0, 0)
  return out
}

/** 兼容旧接口：枚举一条线的全部合法排布（无上限，注意大盘面数量可能很大） */
export function enumerateLine(
  clues: number[],
  line: ArrayLike<number>,
  length: number,
): number[][] {
  return linePlacements(clues, line, length, Number.POSITIVE_INFINITY)
}

/* ────────────────────────── 行 / 列传播 ────────────────────────── */

function sumClues(clues: number[]): number {
  let s = 0
  for (const c of clues) s += c
  return s
}

/** 重叠必黑 / 必白（线索区间交并，与当前盘面无关的必然结论） */
function applyOverlap(
  clues: number[],
  indices: number[],
  apply: (index: number, value: number) => boolean,
): boolean {
  const length = indices.length
  const runs = clues.length
  if (runs === 0) {
    for (const index of indices) if (!apply(index, MARK)) return false
    return true
  }
  const left = new Array<number>(runs)
  const right = new Array<number>(runs)
  let acc = 0
  for (let k = 0; k < runs; k++) {
    left[k] = acc
    acc += clues[k]! + 1
  }
  acc = 0
  for (let k = runs - 1; k >= 0; k--) {
    right[k] = length - acc - clues[k]!
    acc += clues[k]! + 1
  }
  for (let k = 0; k < runs; k++) if (left[k]! > right[k]!) return false
  for (let k = 0; k < runs; k++) {
    const from = Math.max(left[k]!, right[k]!)
    const to = Math.min(left[k]!, right[k]!) + clues[k]!
    for (let i = from; i < to; i++) if (!apply(indices[i]!, BLACK)) return false
  }
  // 所有线索块「可能覆盖」的区间并集之外 → 必白
  let cursor = 0
  for (let k = 0; k < runs; k++) {
    if (left[k]! > cursor) {
      for (let i = cursor; i < left[k]!; i++) if (!apply(indices[i]!, MARK)) return false
    }
    const end = right[k]! + clues[k]!
    if (end > cursor) cursor = end
  }
  for (let i = cursor; i < length; i++) if (!apply(indices[i]!, MARK)) return false
  return true
}

/** 边缘线索 / 线索块边界强制 / 满排定式 */
function applyEdge(
  clues: number[],
  indices: number[],
  cells: number[],
  apply: (index: number, value: number) => boolean,
): boolean {
  const length = indices.length
  const runs = clues.length
  if (runs === 0) {
    for (const index of indices) if (!apply(index, MARK)) return false
    return true
  }
  const minLen = sumClues(clues) + runs - 1
  if (minLen > length) return false

  // 首格已黑 → 第一块必须从行首开始
  if (cells[indices[0]!] === BLACK) {
    for (let i = 0; i < clues[0]!; i++) if (!apply(indices[i]!, BLACK)) return false
    if (runs > 1 && !apply(indices[clues[0]!]!, MARK)) return false
  }
  // 末格已黑 → 最后一块必须贴行尾
  if (cells[indices[length - 1]!] === BLACK) {
    const start = length - clues[runs - 1]!
    for (let i = start; i < length; i++) if (!apply(indices[i]!, BLACK)) return false
    if (runs > 1 && !apply(indices[start - 1]!, MARK)) return false
  }
  // 线索最短总长 = 行长 → 满排唯一
  if (minLen === length) {
    let pos = 0
    for (let k = 0; k < runs; k++) {
      for (let i = 0; i < clues[k]!; i++) if (!apply(indices[pos + i]!, BLACK)) return false
      pos += clues[k]!
      if (k + 1 < runs) {
        if (!apply(indices[pos]!, MARK)) return false
        pos++
      }
    }
  }
  return true
}

export function propagate(
  cells: number[],
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
  onSet?: SetCallback,
  stats?: PropagateStats,
): boolean {
  let changed = true
  while (changed) {
    changed = false

    const apply = (index: number, value: number, kind: RuleKind): boolean => {
      const cur = cells[index]!
      if (cur === value) return true
      if (cur !== EMPTY) return false
      cells[index] = value
      onSet?.(index, value, kind)
      changed = true
      return true
    }

    for (let y = 0; y < h; y++) {
      const indices: number[] = []
      const line: number[] = []
      for (let x = 0; x < w; x++) {
        indices.push(y * w + x)
        line.push(cells[y * w + x]!)
      }
      const clues = rowClues[y] ?? []
      if (!applyOverlap(clues, indices, (i, v) => apply(i, v, 'overlap'))) return false
      if (!applyEdge(clues, indices, cells, (i, v) => apply(i, v, 'edge'))) return false
      if (stats) {
        stats.lineSolves++
        stats.dpStates += (clues.length + 1) * (w + 1)
      }
      const dp = buildLineDp(clues, line, w)
      if (stats) stats.placements += Math.min(dp.count, 1_000_000)
      if (!dp.feasible) return false
      for (let x = 0; x < w; x++) {
        const index = indices[x]!
        if (cells[index] !== EMPTY) continue
        const black = dp.canBlack[x] === 1
        const white = dp.canWhite[x] === 1
        if (black === white) continue // 都行 = 不确定；都不行 = 已判不可行
        if (!apply(index, black ? BLACK : MARK, 'line')) return false
      }
    }

    for (let x = 0; x < w; x++) {
      const indices: number[] = []
      const line: number[] = []
      for (let y = 0; y < h; y++) {
        indices.push(y * w + x)
        line.push(cells[y * w + x]!)
      }
      const clues = colClues[x] ?? []
      if (!applyOverlap(clues, indices, (i, v) => apply(i, v, 'overlap'))) return false
      if (!applyEdge(clues, indices, cells, (i, v) => apply(i, v, 'edge'))) return false
      if (stats) {
        stats.lineSolves++
        stats.dpStates += (clues.length + 1) * (h + 1)
      }
      const dp = buildLineDp(clues, line, h)
      if (stats) stats.placements += Math.min(dp.count, 1_000_000)
      if (!dp.feasible) return false
      for (let y = 0; y < h; y++) {
        const index = indices[y]!
        if (cells[index] !== EMPTY) continue
        const black = dp.canBlack[y] === 1
        const white = dp.canWhite[y] === 1
        if (black === white) continue
        if (!apply(index, black ? BLACK : MARK, 'line')) return false
      }
    }
  }

  return true
}

/* ────────────────────────── 线级反证 / 交叉一致 ────────────────────────── */

export type ProbeSet = (
  index: number,
  value: number,
  kind: 'probe' | 'cross',
) => void

export type ProbeOutcome = 'progress' | 'stuck' | 'contradiction'

/** 一条线的索引 / 线索 / 当前取值 */
interface LineRef {
  indices: number[]
  clues: number[]
  length: number
}

function collectLines(
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
): LineRef[] {
  const out: LineRef[] = []
  for (let y = 0; y < h; y++) {
    const indices: number[] = []
    for (let x = 0; x < w; x++) indices.push(y * w + x)
    out.push({ indices, clues: rowClues[y] ?? [], length: w })
  }
  for (let x = 0; x < w; x++) {
    const indices: number[] = []
    for (let y = 0; y < h; y++) indices.push(y * w + x)
    out.push({ indices, clues: colClues[x] ?? [], length: h })
  }
  return out
}

/**
 * 线级反证 / 交叉一致：
 * 取候选排布最少（且不超过 cap）的一条线，对每种排布整行试放并传播。
 *   - 0 种能延续 → 盘面矛盾；
 *   - 1 种能延续 → 该整行排布必在解中（'probe' 帧）；
 *   - 多种能延续但某格一致 → 该格可确定（'cross' 帧）。
 * @returns progress = 有格子被确定；stuck = 选不出可试的线；contradiction = 矛盾
 */
export function probeLineLevel(
  cells: number[],
  rowClues: number[][],
  colClues: number[][],
  w: number,
  h: number,
  set: ProbeSet,
  stats?: PropagateStats,
  cap = 256,
  probeBudget = 150,
  maxLines = 8,
): ProbeOutcome {
  const lines = collectLines(rowClues, colClues, w, h)

  // 按「候选排布数」从少到多尝试；一条线没有共同结论就换下一条
  const ranked: Array<{ line: LineRef; count: number }> = []
  for (const line of lines) {
    const values: number[] = []
    for (const i of line.indices) values.push(cells[i]!)
    const info = analyzeLine(line.clues, values, line.length)
    if (!info.feasible) return 'contradiction'
    if (info.count <= 1) continue
    if (info.count > cap) continue
    ranked.push({ line, count: info.count })
  }
  ranked.sort((a, b) => a.count - b.count)

  let tried = 0
  for (const { line: best, count } of ranked) {
    if (probeBudget <= 0) break
    if (++tried > maxLines) break
    const values: number[] = []
    for (const i of best.indices) values.push(cells[i]!)
    const placements = linePlacements(best.clues, values, best.length, count)
    if (!placements.length) return 'contradiction'

    const feasible: number[][] = []
    for (const plan of placements) {
      if (probeBudget-- <= 0) break
      if (stats) stats.probes++
      const trial = cells.slice()
      for (let k = 0; k < best.indices.length; k++) trial[best.indices[k]!] = plan[k]!
      if (propagate(trial, rowClues, colClues, w, h)) feasible.push(plan)
    }
    if (!feasible.length) return 'contradiction'

    let progress = false
    if (feasible.length === 1) {
      const plan = feasible[0]!
      for (let k = 0; k < best.indices.length; k++) {
        const index = best.indices[k]!
        if (cells[index] === plan[k]) continue
        cells[index] = plan[k]!
        set(index, plan[k]!, 'probe')
        progress = true
      }
      if (progress) return 'progress'
      continue
    }

    for (let k = 0; k < best.indices.length; k++) {
      const value = feasible[0]![k]!
      let same = true
      for (let q = 1; q < feasible.length; q++) {
        if (feasible[q]![k] !== value) {
          same = false
          break
        }
      }
      if (!same) continue
      const index = best.indices[k]!
      if (cells[index] === value) continue
      cells[index] = value
      if (stats) stats.crossCommits++
      set(index, value, 'cross')
      progress = true
    }
    if (progress) return 'progress'
  }
  return 'stuck'
}

/* ────────────────────────── 解校验 ────────────────────────── */

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

/* ────────────────────────── 规则求解（生成器 / check 用） ────────────────────────── */

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
  stats: PropagateStats
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
  const stats = createPropagateStats()

  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, rowClues, colClues, w, h, undefined, stats)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing, stats }
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
        stats,
      }
    }

    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing, stats }
    }

    usedProbing = true
    const outcome = probeLineLevel(
      grid,
      rowClues,
      colClues,
      w,
      h,
      (index, value) => {
        grid[index] = value
      },
      stats,
    )
    if (outcome === 'contradiction') {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing, stats }
    }
    if (outcome === 'stuck') {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing, stats }
    }
  }

  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing, stats }
}
