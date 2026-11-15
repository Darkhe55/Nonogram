/**
 * 数织 —— 题库加载
 */

import { RAW_PUZZLES } from './puzzles-data'
import {
  asNonogramPuzzle,
  decodeCells,
  decodeClues,
  EMPTY,
  type NonogramPuzzle,
  type NonogramState,
} from './types'

export const builtinPuzzles: NonogramPuzzle[] = []
const solutions = new Map<string, number[]>()

for (const raw of RAW_PUZZLES) {
  const size = raw.width * raw.height
  const decoded = decodeClues(raw.board, raw.height, raw.width)
  if (!decoded) {
    console.warn(`[数织] 线索解码失败：${raw.id}`)
    continue
  }
  const puzzle: NonogramPuzzle = {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    rowClues: decoded.rows,
    colClues: decoded.cols,
  }
  builtinPuzzles.push(puzzle)
  if (raw.solution) {
    const solution = decodeCells(raw.solution, size)
    if (solution) {
      puzzle.solution = solution
      solutions.set(raw.id, solution)
    }
  }
}

export function getReferenceSolution(id: string): NonogramState | null {
  const cells = solutions.get(id)
  if (!cells) return null
  const puzzle = builtinPuzzles.find((p) => p.id === id)
  if (!puzzle) return null
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: new Array<number>(puzzle.width * puzzle.height).fill(EMPTY),
  }
}

export function puzzleById(id: string): NonogramPuzzle | undefined {
  return builtinPuzzles.find((p) => p.id === id)
}

export function referenceFor(puzzle: NonogramPuzzle): number[] | null {
  return asNonogramPuzzle(puzzle).solution ?? solutions.get(puzzle.id) ?? null
}
