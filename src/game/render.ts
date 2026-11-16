/**
 * 数织 —— SVG 渲染与命中
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import {
  asNonogramPuzzle,
  asNonogramState,
  BLACK,
  cluePadding,
  EMPTY,
  MARK,
  NONOGRAM_CELL,
  type NonogramResult,
} from './types'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const p = asNonogramPuzzle(puzzle)
  const cell = NONOGRAM_CELL
  // 留白随线索数量自适应：60×60 这类大盘面的长线索不会再溢出 SVG。
  // 小盘面（内置题）所需留白远小于基准值，结果与旧版完全一致。
  const pad = cluePadding(p.rowClues ?? [], p.colClues ?? [])
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: 1,
  }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asNonogramPuzzle(puzzle)
  const s = asNonogramState(state)
  const r = result as NonogramResult
  const w = puzzle.width
  const h = puzzle.height
  const rowClues = p.rowClues ?? []
  const colClues = p.colClues ?? []

  const bad = new Set<number>(r.badCells ?? [])
  const badRows = new Set<number>()
  const badCols = new Set<number>()
  for (const issue of r.lineIssues ?? []) {
    if (issue.orientation === 'row') badRows.add(issue.index)
    else badCols.add(issue.index)
  }

  const gap = Math.max(1, m.cell * 0.035)
  const inner = m.cell - gap
  const parts: string[] = []

  // 背景
  parts.push(
    `<rect class="ng-board-bg" x="${m.pad - 10}" y="${m.pad - 10}" width="${w * m.cell + 20}" height="${h * m.cell + 20}" rx="${(m.cell * 0.2).toFixed(2)}" />`,
  )

  // 格子
  for (let i = 0; i < w * h; i++) {
    const x = m.pad + (i % w) * m.cell + gap / 2
    const y = m.pad + Math.floor(i / w) * m.cell + gap / 2
    const v = s.cells[i] ?? EMPTY

    let cls = 'ng-cell'
    if (v === BLACK) cls += ' black'
    else if (v === MARK) cls += ' mark'
    else cls += ' empty'
    if (bad.has(i)) cls += ' bad'

    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${(m.cell * 0.1).toFixed(2)}" />`

    if (v === MARK) {
      content += `<text class="ng-x" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + m.cell * 0.02).toFixed(2)}" style="font-size:${(m.cell * 0.38).toFixed(2)}px">×</text>`
    }

    if (bad.has(i)) {
      content += `<rect class="ng-error" x="${(x + 1.1).toFixed(2)}" y="${(y + 1.1).toFixed(2)}" width="${(inner - 2.2).toFixed(2)}" height="${(inner - 2.2).toFixed(2)}" rx="${(m.cell * 0.1).toFixed(2)}" />`
    }

    parts.push(`<g data-index="${i}">${content}</g>`)
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${(m.pad + (i % w) * m.cell).toFixed(2)}" y="${(m.pad + Math.floor(i / w) * m.cell).toFixed(2)}" width="${m.cell.toFixed(2)}" height="${m.cell.toFixed(2)}" />`,
    )
  }

  // 行线索
  const rowParts: string[] = []
  for (let y = 0; y < h; y++) {
    const runs = rowClues[y] ?? []
    const label = runs.length ? runs.join(' ') : '0'
    const cls = badRows.has(y) ? 'ng-row-clue issue' : 'ng-row-clue'
    rowParts.push(
      `<text class="${cls}" x="${(m.pad - 10).toFixed(2)}" y="${(m.pad + y * m.cell + m.cell / 2).toFixed(2)}" style="font-size:${(m.cell * 0.3).toFixed(2)}px">${label}</text>`,
    )
  }
  parts.push(`<g class="ng-row-clues">${rowParts.join('')}</g>`)

  // 列线索
  const colParts: string[] = []
  const lineHeight = m.cell * 0.32
  for (let x = 0; x < w; x++) {
    const runs = colClues[x] ?? []
    const cls = badCols.has(x) ? 'ng-col-clue issue' : 'ng-col-clue'
    for (let k = 0; k < runs.length; k++) {
      const cx = m.pad + x * m.cell + m.cell / 2
      const cy = m.pad - 10 - (runs.length - 1 - k) * lineHeight
      colParts.push(
        `<text class="${cls}" x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" style="font-size:${(m.cell * 0.3).toFixed(2)}px">${runs[k]}</text>`,
      )
    }
  }
  parts.push(`<g class="ng-col-clues">${colParts.join('')}</g>`)

  return `<svg class="board-svg ng-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const col = Math.floor((x - m.pad) / m.cell)
  const row = Math.floor((y - m.pad) / m.cell)
  if (col < 0 || row < 0 || col >= puzzle.width || row >= puzzle.height) return null
  return { index: row * puzzle.width + col }
}
