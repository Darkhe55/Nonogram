/**
 * 数织（Nonograms）题面图片自动导入
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--name 名称] [--append] [--verify]
 *                                   [--width 50 --height 50] [--map 0=1,1=3] [--dry]
 *
 * 流程：
 *   1. Playwright + Edge 把图片画到 canvas 取像素；
 *   2. 投影暗像素找贯穿题板的网格线，最大间隙之外的一组线即棋盘（W×H）；
 *   3. 左侧行提示是一行文字、上方列提示按列堆叠；连通域切出每个数字，20×20 归一化；
 *   4. 多套字体模板自动择优，按字形簇识别数字；数字间距切分多位数；--map 人工覆盖；
 *   5. 预览行/列提示；--append 写入 src/game/puzzles-data.ts；
 *   6. --verify 用项目求解器检查唯一解并生成参考解（超时警告）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const NORM = 20
const CLUSTER_SIM = 0.86

/**
 * 题面图由 matplotlib/PIL 一类工具渲染时数字用的是 DejaVu Sans Bold。
 * 如果本机能找到这份字体，模板匹配会准得多；找不到就退回系统字体自动择优。
 * 可用环境变量 IMPORT_FONT 指定字体文件。
 */
function findDejaVuBold() {
  const cands = []
  if (process.env.IMPORT_FONT) cands.push(process.env.IMPORT_FONT)
  cands.push(
    'C:\\Program Files\\inkstone\\resources\\science-pack\\python\\Lib\\site-packages\\matplotlib\\mpl-data\\fonts\\ttf\\DejaVuSans-Bold.ttf',
  )
  const local = process.env.LOCALAPPDATA
  if (local) {
    const uvRoot = path.join(local, 'uv', 'cache', 'archive-v0')
    try {
      if (fs.existsSync(uvRoot))
        for (const d of fs.readdirSync(uvRoot)) {
          cands.push(path.join(uvRoot, d, 'matplotlib', 'mpl-data', 'fonts', 'ttf', 'DejaVuSans-Bold.ttf'))
          cands.push(
            path.join(uvRoot, d, 'matplotlib', 'mpl-data', 'fonts', 'ttf', 'DejaVuSans.ttf'),
          )
        }
    } catch {
      /* ignore */
    }
  }
  const appData = process.env.APPDATA
  if (appData) {
    const kimi = path.join(appData, 'kimi-desktop', 'daimon-share', 'daimon', 'runtime', 'python')
    const venv = path.join(kimi, '.venv', 'Lib', 'site-packages', 'matplotlib', 'mpl-data', 'fonts', 'ttf')
    cands.push(path.join(venv, 'DejaVuSans-Bold.ttf'))
  }
  return cands.find((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  }) || null
}
const fontPath = findDejaVuBold()
const fontB64 = fontPath ? fs.readFileSync(fontPath).toString('base64') : null

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const arg = (flag, fallback = null) => {
  const i = argv.findIndex((a) => a === flag || a.startsWith(flag + '='))
  if (i < 0) return fallback
  return argv[i].startsWith(flag + '=') ? argv[i].slice(flag.length + 1) : (argv[i + 1] ?? fallback)
}
const imagePath = argv.find((a) => !a.startsWith('--'))
if (!imagePath) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--name 名称] [--append] [--verify] [--width N --height N] [--map 0=1,1=3] [--dry]',
  )
  process.exit(1)
}
if (!fs.existsSync(imagePath)) {
  console.error('找不到图片：', imagePath)
  process.exit(1)
}

const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')
const debugDir = arg('--debug', '')
const maxNodesOpt = Number(arg('--max-nodes', '400000')) || 400000

const manualMap = {}
const manualMapArg = arg('--map', '')
if (manualMapArg) {
  for (const pair of String(manualMapArg).split(',')) {
    const [k, v] = pair.split('=')
    if (k !== undefined && v !== undefined && k.trim() !== '' && v.trim() !== '') {
      manualMap[Number(k)] = Number(v)
    }
  }
}

/* ═══════════════════════════ 像素分析（浏览器内） ═══════════════════════════ */
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(imagePath).toString('base64')
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()

const analyzed = await page.evaluate(
  async ({ u, widthOpt, heightOpt, NORM, debug }) => {
    const img = new Image()
    img.src = u
    await img.decode()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    const px = g.getImageData(0, 0, W, H).data
    const isDark = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      const i = (y * W + x) * 4
      return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 120
    }

    const colC = new Int32Array(W)
    const rowC = new Int32Array(H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (isDark(x, y)) {
          colC[x]++
          rowC[y]++
        }
    const clusters = (counts, thr) => {
      const out = []
      let s = -1
      for (let i = 0; i < counts.length; i++) {
        const on = counts[i] >= thr
        if (on && s < 0) s = i
        if (!on && s >= 0) {
          out.push((s + i - 1) / 2)
          s = -1
        }
      }
      if (s >= 0) out.push((s + counts.length - 1) / 2)
      return out
    }
    // 只保留贯穿棋盘的线；外框/题面文字形成的稀疏峰会被阈值滤掉
    const rawX = clusters(colC, H * 0.7)
    const rawY = clusters(rowC, W * 0.7)
    const boardLines = (lines) => {
      if (lines.length < 3) return lines
      const deltas = []
      for (let i = 1; i < lines.length; i++) deltas.push(lines[i] - lines[i - 1])
      const med = deltas.slice().sort((a, b) => a - b)[Math.floor(deltas.length / 2)]
      // 最大间隙（例如外框到棋盘、提示区与棋盘之间）之后的一组线才是棋盘
      let start = 0
      for (let i = 0; i < deltas.length; i++) if (deltas[i] > med * 3) start = i + 1
      return lines.slice(start)
    }
    const xs = boardLines(rawX)
    const ys = boardLines(rawY)
    const w = widthOpt || xs.length - 1
    const h = heightOpt || ys.length - 1
    if (!(w >= 2) || !(h >= 2)) throw new Error(`无法确定网格：竖线 ${xs.length} 条 / 横线 ${ys.length} 条`)
    if (xs.length !== w + 1 || ys.length !== h + 1) {
      throw new Error(`网格不匹配：识别到 ${xs.length - 1}×${ys.length - 1}，目标 ${w}×${h}`)
    }
    const x0 = xs[0]
    const x1 = xs[w]
    const y0 = ys[0]
    const y1 = ys[h]
    const cellX = (x1 - x0) / w
    const cellY = (y1 - y0) / h

    const normalize = (mask, bw, bh) => {
      const out = new Array(NORM * NORM).fill(0)
      for (let j = 0; j < NORM; j++)
        for (let i = 0; i < NORM; i++) {
          const ax0 = Math.floor((i * bw) / NORM)
          const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
          const ay0 = Math.floor((j * bh) / NORM)
          const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
          let s = 0
          let n = 0
          for (let y = ay0; y < ay1; y++)
            for (let x = ax0; x < ax1; x++) {
              s += mask[y * bw + x]
              n++
            }
          out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
        }
      return out
    }
    const extract = (rx0, ry0, rx1, ry1, group, order) => {
      const xa = Math.max(0, Math.round(rx0))
      const ya = Math.max(0, Math.round(ry0))
      const ww = Math.min(W - xa, Math.round(rx1 - xa))
      const hh = Math.min(H - ya, Math.round(ry1 - ya))
      if (ww <= 0 || hh <= 0) return []
      const mask = new Uint8Array(ww * hh)
      for (let y = 0; y < hh; y++)
        for (let x = 0; x < ww; x++) mask[y * ww + x] = isDark(xa + x, ya + y) ? 1 : 0
      const seen = new Uint8Array(ww * hh)
      const out = []
      for (let i = 0; i < ww * hh; i++) {
        if (!mask[i] || seen[i]) continue
        const stack = [i]
        seen[i] = 1
        let bx0 = ww
        let bx1 = -1
        let by0 = hh
        let by1 = -1
        let area = 0
        while (stack.length) {
          const p = stack.pop()
          area++
          const x = p % ww
          const y = (p / ww) | 0
          if (x < bx0) bx0 = x
          if (x > bx1) bx1 = x
          if (y < by0) by0 = y
          if (y > by1) by1 = y
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue
            const np = ny * ww + nx
            if (mask[np] && !seen[np]) {
              seen[np] = 1
              stack.push(np)
            }
          }
        }
        const bw = bx1 - bx0 + 1
        const bh = by1 - by0 + 1
        // 数字墨迹：面积足够、高度像字形（细长的框线/网格线被排除）
        if (area < 12 || bh < 5 || bh > hh * 0.85 || bw > ww * 0.95) continue
        const sub = new Uint8Array(bw * bh)
        for (let y = 0; y < bh; y++)
          for (let x = 0; x < bw; x++) sub[y * bw + x] = mask[(by0 + y) * ww + bx0 + x]
        // 宽高比像两位数的连通域保留原始位图，交由模板在 Node 里尝试切开
        out.push({
          group,
          order,
          x: xa + bx0,
          y: ya + by0,
          w: bw,
          h: bh,
          area,
          m: normalize(sub, bw, bh),
          raw: bw > bh * 0.95 ? Array.from(sub) : null,
        })
      }
      return out
    }

    const glyphs = []
    // 行提示：棋盘左侧，每行一段右对齐文字（最多约 9 个数）
    for (let j = 0; j < h; j++) {
      const cy = y0 + (j + 0.5) * cellY
      glyphs.push(
        ...extract(x0 - 9.6 * cellX, cy - 0.42 * cellY, x0 - 0.06 * cellX, cy + 0.42 * cellY, `r${j}`, j),
      )
    }
    // 列提示：棋盘上方，每列一格宽、向上堆叠
    for (let i = 0; i < w; i++) {
      const cx = x0 + (i + 0.5) * cellX
      glyphs.push(
        ...extract(cx - 0.5 * cellX, y0 - 9.4 * cellY, cx + 0.5 * cellX, y0 - 0.06 * cellY, `c${i}`, i),
      )
    }

    // 调试覆盖：标出棋盘网格与数字包围盒
    let overlay = null
    if (debug) {
      const oc = document.createElement('canvas')
      oc.width = W
      oc.height = H
      const og = oc.getContext('2d')
      og.drawImage(img, 0, 0)
      og.strokeStyle = 'rgba(30,120,220,0.9)'
      og.lineWidth = 2
      og.strokeRect(x0, y0, x1 - x0, y1 - y0)
      og.strokeStyle = 'rgba(220,30,30,0.9)'
      og.lineWidth = 1
      for (const gl of glyphs) og.strokeRect(gl.x, gl.y, gl.w, gl.h)
      overlay = oc.toDataURL('image/png').slice('data:image/png;base64,'.length)
    }
    return { W, H, w, h, x0, y0, x1, y1, cellX, cellY, glyphs, overlay }
  },
  { u: dataUrl, widthOpt, heightOpt, NORM, debug: !!debugDir },
)
if (analyzed.overlay) {
  const counts = {}
  for (const gl of analyzed.glyphs) counts[gl.group] = (counts[gl.group] || 0) + 1
  console.log('[debug] 每行/列字形数：', JSON.stringify(counts))
}
if (analyzed.overlay) {
  const dir = debugDir || '.'
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, path.basename(imagePath, path.extname(imagePath)) + '-glyphs.png')
  fs.writeFileSync(out, Buffer.from(analyzed.overlay, 'base64'))
  console.log(`[import] 调试覆盖图已写入 ${out}`)
}

/* ═══════════════════════════ 字体模板 + 字形分类 ═══════════════════════════ */
const medH = (() => {
  const hs = analyzed.glyphs.map((gl) => gl.h).sort((a, b) => a - b)
  return hs.length ? hs[Math.floor(hs.length / 2)] : 15
})()
const FONTS = []
if (fontB64) FONTS.push({ fam: 'ImportFont', weight: 400 })
for (const fam of ['Tahoma', 'Verdana', 'Arial', 'Segoe UI', 'Calibri'])
  for (const weight of [700, 400]) FONTS.push({ fam, weight })
const SIZES = [...new Set([0.66, 0.7, 0.74].map((r) => Math.max(8, Math.round(medH / r))))]

const templates = await page.evaluate(
  async ({ FONTS, SIZES, NORM, fontB64 }) => {
    if (fontB64) {
      const face = new FontFace(
        'ImportFont',
        `url(data:font/ttf;base64,${fontB64})`,
      )
      await face.load()
      document.fonts.add(face)
      await document.fonts.ready
    }
    const render = (fam, weight, size, ch) => {
      const c = document.createElement('canvas')
      c.width = 160
      c.height = 160
      const g = c.getContext('2d', { willReadFrequently: true })
      g.fillStyle = '#fff'
      g.fillRect(0, 0, 160, 160)
      g.fillStyle = '#000'
      g.font = `${weight} ${size}px "${fam}"`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(ch, 80, 80)
      const d = g.getImageData(0, 0, 160, 160).data
      const dark = (x, y) => {
        const i = (y * 160 + x) * 4
        return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 120
      }
      let x0 = 160
      let x1 = -1
      let y0 = 160
      let y1 = -1
      for (let y = 0; y < 160; y++)
        for (let x = 0; x < 160; x++)
          if (dark(x, y)) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
      if (x1 < 0) return null
      const bw = x1 - x0 + 1
      const bh = y1 - y0 + 1
      const out = new Array(NORM * NORM).fill(0)
      for (let j = 0; j < NORM; j++)
        for (let i = 0; i < NORM; i++) {
          const ax0 = Math.floor((i * bw) / NORM)
          const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
          const ay0 = Math.floor((j * bh) / NORM)
          const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
          let s = 0
          let n = 0
          for (let y = ay0; y < ay1; y++)
            for (let x = ax0; x < ax1; x++) {
              s += dark(x0 + x, y0 + y) ? 1 : 0
              n++
            }
          out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
        }
      return out
    }
    const out = []
    for (const f of FONTS)
      for (const size of SIZES) {
        const digits = []
        for (const ch of '0123456789') digits.push(render(f.fam, f.weight, size, ch))
        out.push({ fam: f.fam, weight: f.weight, size, digits })
      }
    return out
  },
  { FONTS, SIZES, NORM, fontB64 },
)
await browser.close()

const sim = (a, b) => {
  let inter = 0
  let uni = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++
    if (a[i] || b[i]) uni++
  }
  return uni ? inter / uni : 0
}
const bestDigit = (mask, tpl) => {
  let best = -1
  let bestScore = -1
  let second = -1
  for (let d = 0; d < 10; d++) {
    const s = sim(mask, tpl.digits[d])
    if (s > bestScore) {
      second = bestScore
      bestScore = s
      best = d
    } else if (s > second) second = s
  }
  return { digit: best, score: bestScore, margin: bestScore - second }
}
/** 把位图按包围盒重采样成 NORM×NORM 二值图 */
const normBits = (bits, bw, bh) => {
  const out = new Array(NORM * NORM).fill(0)
  for (let j = 0; j < NORM; j++)
    for (let i = 0; i < NORM; i++) {
      const ax0 = Math.floor((i * bw) / NORM)
      const ax1 = Math.max(ax0 + 1, Math.floor(((i + 1) * bw) / NORM))
      const ay0 = Math.floor((j * bh) / NORM)
      const ay1 = Math.max(ay0 + 1, Math.floor(((j + 1) * bh) / NORM))
      let s = 0
      let n = 0
      for (let y = ay0; y < ay1; y++)
        for (let x = ax0; x < ax1; x++) {
          s += bits[y * bw + x]
          n++
        }
      out[j * NORM + i] = s / n >= 0.5 ? 1 : 0
    }
  return out
}
/** 粘连的两位数：尝试所有切点，取左右两半各自模板匹配最好的一组 */
const classifyCut = (gl, tpl) => {
  if (!gl.raw || gl.w <= gl.h * 0.95) return null
  const bw = gl.w
  const bh = gl.h
  let best = null
  for (let cut = Math.ceil(bw * 0.28); cut <= Math.floor(bw * 0.72); cut++) {
    if (cut < 4 || bw - cut < 4) continue
    const left = new Uint8Array(cut * bh)
    const right = new Uint8Array((bw - cut) * bh)
    let inkL = 0
    let inkR = 0
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < cut; x++) {
        left[y * cut + x] = gl.raw[y * bw + x]
        inkL += left[y * cut + x]
      }
      for (let x = cut; x < bw; x++) {
        right[y * (bw - cut) + (x - cut)] = gl.raw[y * bw + x]
        inkR += right[y * (bw - cut) + (x - cut)]
      }
    }
    if (inkL < 8 || inkR < 8) continue
    const sl = bestDigit(normBits(left, cut, bh), tpl)
    const sr = bestDigit(normBits(right, bw - cut, bh), tpl)
    const score = (sl.score + sr.score) / 2
    if (!best || score > best.score) {
      best = {
        label: `${sl.digit}${sr.digit}`,
        score,
        margin: Math.min(sl.margin, sr.margin),
        cut,
        parts: [`${sl.digit}:${sl.score.toFixed(2)}`, `${sr.digit}:${sr.score.toFixed(2)}`],
      }
    }
  }
  return best
}
/** 单个连通域 → 数字串（多数是 1 位；检出粘连时切成两位） */
const classifyGlyph = (gl, tpl) => {
  const single = bestDigit(gl.m, tpl)
  if (gl.raw) {
    const cut = classifyCut(gl, tpl)
    if (cut && cut.score >= single.score + 0.015) return cut
  }
  return { label: String(single.digit), score: single.score, margin: single.margin }
}

let chosen = null
const fontRanking = []
for (const cand of templates) {
  let total = 0
  for (const gl of analyzed.glyphs) total += classifyGlyph(gl, cand).score
  const avg = analyzed.glyphs.length ? total / analyzed.glyphs.length : 0
  fontRanking.push({ name: `${cand.fam} ${cand.weight}@${cand.size}`, avg })
  if (!chosen || avg > chosen.avg) chosen = { ...cand, avg }
}
if (debugDir) {
  fontRanking.sort((a, b) => b.avg - a.avg)
  console.log(`[debug] 字体模板: ${fontPath || '未找到 DejaVu'}`)
  for (const r of fontRanking.slice(0, 6)) console.log(`[debug]   ${r.name} avg=${r.avg.toFixed(3)}`)
}
if (!chosen) {
  console.error('[import] 没有可用字体模板')
  process.exit(1)
}

const clusterOf = []
const clusters = []
for (let gi = 0; gi < analyzed.glyphs.length; gi++) {
  const gl = analyzed.glyphs[gi]
  let best = -1
  let bestScore = CLUSTER_SIM
  for (let k = 0; k < clusters.length; k++) {
    const s = sim(gl.m, clusters[k].mask)
    if (s > bestScore) {
      bestScore = s
      best = k
    }
  }
  if (best < 0) {
    clusters.push({ mask: gl.m, members: [] })
    best = clusters.length - 1
  }
  clusters[best].members.push(gi)
  clusterOf[gi] = best
}
const clusterDigit = []
for (let k = 0; k < clusters.length; k++) {
  const votes = new Map()
  for (const gi of clusters[k].members) {
    const r = classifyGlyph(analyzed.glyphs[gi], chosen)
    votes.set(r.label, (votes.get(r.label) || 0) + 1)
  }
  let label = '0'
  let count = -1
  for (const [lbl, n] of votes) if (n > count) { count = n; label = lbl }
  const sorted = [...votes.values()].sort((a, b) => b - a)
  const n = clusters[k].members.length
  clusterDigit[k] = {
    label,
    count: n,
    score: sorted[0] / n,
    margin: (sorted[0] - (sorted[1] || 0)) / n,
    final: manualMap[k] !== undefined ? String(manualMap[k]) : label,
    manual: manualMap[k] !== undefined,
  }
}
console.log(
  `[import] 字体自动择优：${chosen.fam === 'ImportFont' ? 'DejaVu Sans Bold' : chosen.fam + ' ' + chosen.weight} / ${chosen.size}px（平均字形相似度 ${chosen.avg.toFixed(3)}），字形簇 ${clusters.length} 个`,
)
for (let k = 0; k < clusters.length; k++) {
  const c = clusterDigit[k]
  const tag = c.manual ? `人工→${c.final}` : `自动→${c.label}`
  const warn = !c.manual && (c.margin < 0.06 || c.score < 0.72) ? '  ⚠ 低置信' : ''
  console.log(
    `  簇${k}: ${tag}（n=${c.count}，一致率 ${c.score.toFixed(3)}，与次优差 ${c.margin.toFixed(3)}）${warn}`,
  )
}
const lowConfidence = clusterDigit.some((c) => !c.manual && (c.margin < 0.06 || c.score < 0.72))
if (lowConfidence) {
  console.warn('[import] 存在低置信字形簇：可用 --map 0=3,1=2 人工指定；默认仍按自动结果继续。')
}

// 每格数字（可能是 1~2 位连写）
const digitOf = (gi) => clusterDigit[clusterOf[gi]].final
const { w, h, x0, y0, x1, y1, cellX, cellY } = analyzed

// ── 行提示：同一行内按 x 排序，按间距切分多位数 ──
const splitByGap = (list, gapLimit) => {
  const ordered = list.slice().sort((a, b) => a.x - b.x)
  const numbers = []
  let cur = null
  for (const gl of ordered) {
    if (cur && gl.x - (cur.lastX + cur.lastW) <= gapLimit) {
      cur.digits.push(...digitOf(gl.index))
      cur.lastX = gl.x
      cur.lastW = gl.w
    } else {
      cur = { digits: [...digitOf(gl.index)], lastX: gl.x, lastW: gl.w }
      numbers.push(cur)
    }
  }
  return numbers.map((n) => Number(n.digits.join('')))
}
const byGroup = new Map()
analyzed.glyphs.forEach((gl, gi) => {
  const giObj = { ...gl, index: gi }
  if (!byGroup.has(gl.group)) byGroup.set(gl.group, [])
  byGroup.get(gl.group).push(giObj)
})
const gapLimit = Math.max(2, medH * 0.28)
if (debugDir) {
  for (const key of ['r29', 'r30', 'r32', 'r34', 'c25']) {
    console.log(
      `[debug] ${key}: ` +
        (byGroup.get(key) || [])
          .map((gl) => `${gl.x}:${digitOf(gl.index)}(w${gl.w},h${gl.h})`)
          .join(' '),
    )
  }
}
const rowClues = []
for (let j = 0; j < h; j++) rowClues.push(splitByGap(byGroup.get(`r${j}`) || [], gapLimit))

// ── 列提示：同列内按 y 分成多行，每行一个数 ──
const colClues = []
for (let i = 0; i < w; i++) {
  const list = (byGroup.get(`c${i}`) || []).slice().sort((a, b) => a.y - b.y)
  const lines = []
  for (const gl of list) {
    const last = lines[lines.length - 1]
    if (last && gl.y + gl.h / 2 - last.bottom <= Math.max(2, medH * 0.32)) {
      last.items.push(gl)
      last.bottom = gl.y + gl.h
    } else {
      lines.push({ items: [gl], bottom: gl.y + gl.h })
    }
  }
  colClues.push(
    lines.map((line) =>
      Number(
        line.items
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((gl) => digitOf(gl.index))
          .join(''),
      ),
    ),
  )
}

/* ═══════════════════════════ 合法性 + 预览 ═══════════════════════════ */
const clueError = []
for (let j = 0; j < h; j++) {
  const sum = rowClues[j].reduce((a, b) => a + b, 0) + Math.max(0, rowClues[j].length - 1)
  if (rowClues[j].some((v) => v < 1) || sum > w) clueError.push(`行 ${j + 1}：${rowClues[j].join(' ')}`)
}
for (let i = 0; i < w; i++) {
  const sum = colClues[i].reduce((a, b) => a + b, 0) + Math.max(0, colClues[i].length - 1)
  if (colClues[i].some((v) => v < 1) || sum > h) clueError.push(`列 ${i + 1}：${colClues[i].join(' ')}`)
}
console.log(
  `[import] ${path.basename(imagePath)}：${analyzed.W}×${analyzed.H} 像素，网格 ${w}×${h}，` +
    `字形 ${analyzed.glyphs.length} 个，行提示 ${rowClues.length} 行、列提示 ${colClues.length} 列`,
)
console.log('[import] 行提示：')
rowClues.forEach((r, j) => console.log(`  ${String(j + 1).padStart(2)} | ${r.join(' ')}`))
console.log('[import] 列提示：')
colClues.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)} | ${c.join(' ')}`))
if (clueError.length) {
  console.error(
    `[import] 有 ${clueError.length} 条提示不合法（数字缺失或总长超界）：\n  ${clueError.slice(0, 10).join('\n  ')}\n可用 --map 修正字形簇，或 --width/--height 指定网格。`,
  )
  process.exit(1)
}

if (dry) {
  console.log('[import] --dry：仅识别预览，不求解、不写入。')
  process.exit(0)
}

/* ═══════════════════════════ 求解 / 唯一性（子进程隔离） ═══════════════════════════ */
/**
 * 大盘求解可能很慢、递归很深（甚至有栈溢出风险）。放到子进程里跑，
 * 超时或崩溃只警告，不拖垮导入流程。
 */
function runSolverChild(code, payload, timeoutMs, solverPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        IMPORT_SOLVER: pathToFileURL(solverPath).href,
        IMPORT_PAYLOAD: JSON.stringify(payload),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill()
      resolve({ status: 'timeout', stdout, stderr })
    }, timeoutMs)
    child.on('close', (code2) => {
      clearTimeout(timer)
      resolve({ status: code2 === 0 ? 'ok' : 'crash', code: code2, stdout, stderr })
    })
  })
}

const verifyTimeout = Number(arg('--verify-timeout', '120000')) || 120000
const size = w * h
let solution = ''
const t0 = Date.now()
if (verify) {
  const res = await runSolverChild(
    `
const mod = await import(process.env.IMPORT_SOLVER)
const p = JSON.parse(process.env.IMPORT_PAYLOAD)
const counted = mod.countSolutions(p.rowClues, p.colClues, p.size, p.w, p.h, 2, p.maxNodes)
let solution = ''
if (counted.count === 1 && !counted.timedOut) {
  const s = mod.solvePuzzle(
    { id: 'import-temp', name: 'import-temp', width: p.w, height: p.h, difficulty: 'hard', rowClues: p.rowClues, colClues: p.colClues },
    p.maxNodes,
  )
  if (s.solved && s.solution) solution = s.solution.cells.map((v) => (v === 1 ? '1' : '2')).join('')
}
console.log(JSON.stringify({ count: counted.count, nodes: counted.nodes, timedOut: counted.timedOut, solution }))
`,
    { rowClues, colClues, size, w, h, maxNodes: maxNodesOpt },
    verifyTimeout,
    'src/game/solver.ts',
  )
  if (res.status === 'ok') {
    const line = res.stdout.trim().split('\n').filter(Boolean).pop() || '{}'
    let data = {}
    try {
      data = JSON.parse(line)
    } catch {
      data = {}
    }
    if (data.timedOut) {
      console.warn(
        `[import] 唯一性检查超时（${data.nodes} 节点，${Date.now() - t0}ms）：未能确认唯一解，条目不写参考解。可加 --verify-timeout/--max-nodes 放宽。`,
      )
    } else if (data.count === 0) {
      console.error('[import] 求解无解：数字识别可能有误。')
      process.exit(1)
    } else if (data.count !== 1) {
      console.error(`[import] 解不唯一：${data.count} 个（${data.nodes} 节点）。`)
      process.exit(1)
    } else {
      console.log(`[import] 唯一解校验通过（${data.nodes} 节点，${Date.now() - t0}ms）`)
      if (data.solution) {
        solution = data.solution
        console.log(`[import] 已生成参考解（${solution.length} 格）`)
      } else {
        console.warn('[import] 求解器未能生成参考解，条目不写参考解。')
      }
    }
  } else if (res.status === 'timeout') {
    console.warn(
      `[import] 唯一性检查超过 ${verifyTimeout}ms 未完成（已终止）：未确认唯一解，条目不写参考解。`,
    )
  } else {
    console.warn(
      `[import] 唯一性检查子进程异常退出（${res.code}，可能题板过大/内存不足）：未确认唯一解，条目不写参考解。`,
    )
  }
} else {
  console.log('[import] 未加 --verify：跳过唯一解校验。')
}

const id = arg('--id', `nonogram-import-${Date.now().toString(36)}`)
const board = `${rowClues.map((r) => r.join(',')).join(';')}|${colClues.map((c) => c.join(',')).join(';')}`

if (!append) {
  console.log('[import] 预览模式（未写入）。加 --append 写入 src/game/puzzles-data.ts。')
  process.exit(0)
}
const dataFile = path.resolve('src/game/puzzles-data.ts')
if (!fs.existsSync(dataFile)) {
  console.error('[import] 找不到 src/game/puzzles-data.ts')
  process.exit(1)
}
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${w}, height: ${h}, difficulty: 'hard', series: ${JSON.stringify(series)}, board: ${JSON.stringify(board)}, solution: ${JSON.stringify(solution)} },\n`
let text = fs.readFileSync(dataFile, 'utf8').replace(/\r\n/g, '\n')
const marker = text.lastIndexOf('\n]')
if (marker < 0) {
  console.error('[import] puzzles-data.ts 格式异常：找不到结尾 ]')
  process.exit(1)
}
text = text.slice(0, marker + 1) + '\n' + entry + text.slice(marker + 1)
fs.writeFileSync(dataFile, text)
console.log(`[import] 已写入 ${dataFile}：${id} ${name}`)
