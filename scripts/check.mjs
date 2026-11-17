/**
 * 数织题库审计
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BLACK, cluesFromSolution, decodeCells, decodeClues } from '../src/game/types.ts'
import { isValidSolution } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'
import { planLogicSolve } from '../src/game/logic.ts'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const text = readFileSync(DATA_FILE, 'utf8')

const entries = []
const re =
  /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*width:\s*(\d+),\s*height:\s*(\d+),\s*difficulty:\s*'([^']+)',\s*series:\s*"([^"]+)",\s*board:\s*"([^"]*)",\s*solution:\s*"([^"]*)"\s*\}/g
let m
while ((m = re.exec(text)) !== null) {
  entries.push({
    id: m[1],
    name: m[2],
    width: Number(m[3]),
    height: Number(m[4]),
    difficulty: m[5],
    series: m[6],
    board: m[7],
    solution: m[8],
  })
}

let errors = 0
let warnings = 0
const ids = new Set()

for (const e of entries) {
  const size = e.width * e.height
  if (ids.has(e.id)) {
    console.error(`[check] 重复 id: ${e.id}`)
    errors++
  }
  ids.add(e.id)
  if (e.width <= 0 || e.height <= 0) {
    console.error(`[check] ${e.id} 宽高非法`)
    errors++
    continue
  }

  const decoded = decodeClues(e.board, e.height, e.width)
  const solution = decodeCells(e.solution, size)
  if (!decoded || !solution) {
    console.error(`[check] ${e.id} 线索/解编码非法`)
    errors++
    continue
  }

  const derived = cluesFromSolution(solution, e.width, e.height)
  if (
    JSON.stringify(derived.rows) !== JSON.stringify(decoded.rows) ||
    JSON.stringify(derived.cols) !== JSON.stringify(decoded.cols)
  ) {
    console.error(`[check] ${e.id} 线索与参考解不一致`)
    errors++
    continue
  }

  if (!isValidSolution(solution, decoded.rows, decoded.cols, e.width, e.height)) {
    console.error(`[check] ${e.id} 参考解不合法`)
    errors++
    continue
  }

  const counted = countSolutions(decoded.rows, decoded.cols, size, e.width, e.height, 2, 800_000)
  if (counted.timedOut) {
    console.warn(`[check] ${e.id} 唯一解检查超时（${counted.nodes} 节点）`)
    warnings++
  } else if (counted.count !== 1) {
    console.error(`[check] ${e.id} 解不唯一：找到 ${counted.count} 个`)
    errors++
    continue
  }

  const puzzle = {
    id: e.id,
    name: e.name,
    width: e.width,
    height: e.height,
    difficulty: e.difficulty,
    rowClues: decoded.rows,
    colClues: decoded.cols,
  }
  const plan = planLogicSolve(puzzle, {
    puzzleId: e.id,
    width: e.width,
    height: e.height,
    cells: new Array(size).fill(0),
    givens: new Array(size).fill(0),
  })
  const st = plan.stats ?? {}
  const byRule = {}
  for (const f of plan.frames) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
  const ruleText = Object.entries(byRule).map(([k, v]) => `R${k}:${v}`).join(' ') || '-'
  if (!plan.finalState || !plan.saturated) {
    console.warn(`[check] ${e.id} 需要回溯（逻辑推演未饱和）`)
    warnings++
  } else if (!isValidSolution(plan.finalState.cells, decoded.rows, decoded.cols, e.width, e.height)) {
    console.error(`[check] ${e.id} 逻辑推演终态不合法`)
    errors++
  }

  const black = solution.filter((v) => v === BLACK).length
  console.log(
    `[check] ${e.id} ${e.width}×${e.height} 黑格 ${black} · 解唯一 · 逻辑可推满 · ${counted.nodes} 节点` +
      `（${ruleText}；线解 ${st.lineSolves ?? 0} · DP ${st.dpStates ?? 0} 状态 · ` +
      `反证 ${st.probes ?? 0} 次 · 回溯 ${st.searchNodes ?? 0} 节点 · ${plan.frames.length} 帧）`,
  )
}

console.log(`[check] 共 ${entries.length} 题，错误 ${errors}，警告 ${warnings}`)
if (entries.length === 0) {
  console.warn('[check] 题库为空，请先运行 npm run gen。')
}
if (errors > 0) process.exitCode = 1
