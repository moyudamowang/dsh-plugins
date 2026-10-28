// Layered-band layout, v5. Deterministic, and self-checked against every readability rule.
// The picture is meant to be *read*, so the rules below are hard constraints, not preferences.
//
//   1. boxes sit on a fixed column grid inside their band; one band = one group = consecutive rows
//   2. an edge that spans rows inside a band uses the band's lane
//   3. an edge that spans bands keeps ONE column for the whole descent (staircase, never zigzag)
//   4. an edge label sits ON its own line, masked by a halo — attribution is never ambiguous
//   5. checks: line/box, label/box, label/label, label/border, label/canvas,
//              horizontal run inside a foreign band, label off its own line
import { readFileSync, writeFileSync } from 'node:fs'

export const BOX_H = 54, ROW_GAP = 40, BAND_HEAD = 34, BAND_GAP = 72
const GAP_X = 36, BAND_PX = 20, BAND_PB = 16
const LANE = 34

const TONE = { run: '#1f6feb', state: '#15803d', warn: '#b45309', bad: '#c2410c', plain: '#9aa4b1' }
const toneOf = (v) => TONE[v] || TONE.plain

export function textW(s) {
  let w = 0
  for (const ch of String(s)) w += ch.codePointAt(0) > 0x2e80 ? 10.2 : 5.7
  return w
}

export function layout(data, avail = 900) {
  const groups = data.groups && data.groups.length ? data.groups : [{ id: '__all', title: '' }]
  const nodes = data.nodes || [], edges = data.edges || []
  const A = Math.max(280, avail)

  // ---- column grid ----
  // ONE rule for every picture: a group is one row. Whatever the biggest group needs, that is the
  // column count — so a small graph and a big graph are drawn by the same logic, and only when the
  // pane is too narrow for that do we wrap.
  const X0 = A < 620 ? 26 : 44
  const sizes = (groups.length ? groups : [{ id: '__all' }]).map((g) =>
    g.id === '__all'
      ? nodes.filter((n) => !groups.some((q) => String(q.id) === String(n.group))).length
      : nodes.filter((n) => String(n.group) === String(g.id)).length)
  const rawW = (p) => (A - 2 * X0 - (p - 1) * GAP_X) / p
  const maxGroup = Math.min(5, Math.max(2, Math.max(...sizes, 1)))
  const noOrphan = (p) => sizes.every((s) => s <= p || s % p !== 1)
  let perRow = 2
  for (let p = maxGroup; p >= 2; p--) {
    if (rawW(p) >= 132 && noOrphan(p)) { perRow = p; break }
    if (p === 2) perRow = noOrphan(2) ? 2 : 2
  }
  const boxW = Math.max(86, Math.min(212, Math.floor(rawW(perRow))))
  const colX = (i) => X0 + i * (boxW + GAP_X)

  const membersOf = (g) => (g.id === '__all' ? nodes.filter((n) => !groups.some((q) => String(q.id) === String(n.group))) : nodes.filter((n) => String(n.group) === String(g.id)))

  // ---- rows ----
  const layers = [], bands = [], boxMap = new Map()
  let y = 0
  for (const g of groups) {
    const members = membersOf(g)
    const rows = Math.max(1, Math.ceil(members.length / perRow))
    const needsLane = edges.some((e) => {
      const a = members.findIndex((n) => String(n.id) === String(e.from))
      const b = members.findIndex((n) => String(n.id) === String(e.to))
      if (a < 0 || b < 0) return false
      return Math.floor(a / perRow) === Math.floor(b / perRow) && Math.abs(a - b) > 1
    })
    const bandTop = y
    y += BAND_HEAD
    for (let r = 0; r < rows; r++) {
      const slice = members.slice(r * perRow, (r + 1) * perRow)
      const boxes = slice.map((node, i) => {
        const box = { node, layer: layers.length, idx: i, x: colX(i), y, w: boxW, h: BOX_H }
        boxMap.set(String(node.id), box)
        return box
      })
      layers.push({ y, h: BOX_H, boxes, band: bands.length })
      y += BOX_H + (r === rows - 1 ? 0 : ROW_GAP)
    }
    y += LANE
    bands.push({ id: String(g.id), title: g.title || '', note: g.note || '', tone: g.tone || 'plain', y: bandTop, h: y - bandTop + BAND_PB, laneY: y - LANE / 2 })
    y += BAND_GAP
  }

  // ---- crossing reduction: a line that never crosses is a line you never have to trace ----
  // Order each row by the mean column of its neighbours in the other rows — down and up, several
  // passes. Deterministic; it reorders boxes only, never the meaning. A line that never crosses is
  // a line you never have to trace.
  const nbrs = new Map()
  for (const b of boxMap.values()) nbrs.set(String(b.node.id), [])
  for (const e of edges) {
    const a = boxMap.get(String(e.from)), b = boxMap.get(String(e.to))
    if (!a || !b || a === b) continue
    nbrs.get(String(e.from)).push(String(e.to))
    nbrs.get(String(e.to)).push(String(e.from))
  }
  const cx = new Map()
  for (const L of layers) for (const b of L.boxes) cx.set(String(b.node.id), b.x + b.w / 2)
  const reflow = (L) => L.boxes.forEach((b, i) => { b.idx = i; b.x = colX(i); cx.set(String(b.node.id), b.x + b.w / 2) })
  for (let sweep = 0; sweep < 4; sweep++) {
    const idx = layers.map((_, i) => i)
    for (const k of sweep % 2 === 0 ? idx : idx.reverse()) {
      const L = layers[k]
      if (!L.boxes.length) continue
      const key = (b) => {
        const ns = (nbrs.get(String(b.node.id)) || [])
          .filter((id) => boxMap.get(id) && boxMap.get(id).layer !== L.boxes[0].layer)
          .map((id) => cx.get(id)).filter((v) => v != null)
        return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : b.x + b.w / 2
      }
      L.boxes.sort((p, q) => key(p) - key(q) || p.idx - q.idx)
      reflow(L)
    }
  }

  // ---- colour ----
  // Every line must be distinguishable from every other line, whatever the data looks like.
  // The colour key is `kind` when the data gives one, otherwise the edge label, otherwise the edge
  // itself. The renderer still never interprets the word — it only groups identical strings.
  // Lines of the same relation therefore share a colour, and no two unrelated relations do.
  const KIND_COLORS = ['#1f6feb', '#15803d', '#b45309', '#7c3aed', '#be185d', '#0e7490']
  const kindColor = new Map()
  const keyOf = (e, i) => String(e.kind || e.label || '#' + i)
  const edgeColor = edges.map((e, i) => {
    const k = keyOf(e, i)
    if (!kindColor.has(k)) kindColor.set(k, KIND_COLORS[kindColor.size % KIND_COLORS.length])
    return kindColor.get(k)
  })

  // ---- horizontal extent ----
  let right = 0
  for (const L of layers) for (const b of L.boxes) right = Math.max(right, b.x + b.w)
  const width = Math.max(right + X0, 260)
  for (const b of bands) { b.x = BAND_PX; b.w = width - BAND_PX * 2 }

  const notes = data.notes || []
  const notesTop = y - BAND_GAP + (notes.length ? 26 : 0)
  const legendTop = notesTop + notes.length * 17 + (kindColor.size ? 14 : 0)
  const height = legendTop + (kindColor.size ? 18 : 0) + 4

  // the only empty horizontal band between two rows: a row gap, or the gutter between two bands
  const gapBetween = (upLayer, dnLayer) => {
    const bu = bands[layers[upLayer].band], bd = bands[layers[dnLayer].band]
    if (bu !== bd) return (bu.y + bu.h + bd.y) / 2
    return (layers[upLayer].y + layers[upLayer].h + layers[dnLayer].y) / 2
  }
  const gapBelow = (i) => {
    const L = layers[i], nxt = layers[i + 1]
    if (!nxt) return L.y + L.h + LANE / 2
    return (L.y + L.h + nxt.y) / 2
  }
  const gapAbove = (i) => {
    const L = layers[i], prv = layers[i - 1]
    if (!prv) return L.y - LANE / 2
    return (prv.y + prv.h + L.y) / 2
  }

  // ---- candidate vertical columns (same grid for every full row) ----
  const columns = []
  columns.push(12)
  for (let k = 1; k < perRow; k++) columns.push(X0 + k * (boxW + GAP_X) - GAP_X / 2)
  columns.push(width - 12)
  const freeColumn = (x, from, to) => {
    for (let i = from; i <= to; i++) {
      for (const b of layers[i].boxes) if (x > b.x - 5 && x < b.x + b.w + 5) return false
    }
    return true
  }

  // ---- routing ----
  // Horizontal runs all live in the strip under a row ("gap k"). Count how many each gap needs
  // first, then spread them evenly: two runs must never share a y, or the drawing shows one line
  // where there are two.
  const usedCols = new Map()
  // A run between two rows lives in the empty strip between them; a run that leaves a band lives in
  // the gutter between the band frames, never inside a band it does not belong to.
  const gapStrip = (k) => {
    const i = layers[k], nxt = layers[k + 1]
    const bu = bands[i.band]
    let lo = i.y + i.h + 12
    let hi = nxt ? nxt.y - 12 : bu.y + bu.h - 12
    if (nxt && bands[nxt.band] !== bu) {
      lo = Math.max(lo, bu.y + bu.h + 12)
      hi = Math.min(hi, bands[nxt.band].y - 12)
    }
    if (hi < lo) { const m = (lo + hi) / 2; lo = m; hi = m }
    return [lo, hi]
  }
  // a same-row edge loops under its own row, inside its own band
  const rowStrip = (k) => {
    const i = layers[k], bu = bands[i.band]
    const lo = i.y + i.h + 7
    const hi = Math.min(bu.y + bu.h - 7, lo + LANE - 14)
    return [lo, Math.max(lo, hi)]
  }
  const gapUse = new Map()
  const bumpGap = (key) => gapUse.set(key, (gapUse.get(key) || 0) + 1)
  for (const e of edges) {
    const a = boxMap.get(String(e.from)), b = boxMap.get(String(e.to))
    if (!a || !b) continue
    if (a.layer === b.layer) { if (Math.abs(a.idx - b.idx) !== 1) bumpGap('r' + a.layer); continue }
    const up = a.y <= b.y ? a : b, dn = a.y <= b.y ? b : a
    bumpGap('g' + up.layer)
    if (dn.layer - 1 !== up.layer) bumpGap('g' + (dn.layer - 1))
  }
  const gapTaken = new Map()
  const laneIn = (key, strip) => {
    const [lo, hi] = strip
    const n = Math.max(1, gapUse.get(key) || 1)
    const t = gapTaken.get(key) || 0
    gapTaken.set(key, t + 1)
    return lo + ((t + 0.5) * (hi - lo)) / n
  }
  // ---- ports ----
  // Several edges on the same box side get their own x, or they draw one line with one arrowhead.
  const starts = new Map(), ends = new Map()
  edges.forEach((e, i) => {
    const a = boxMap.get(String(e.from)), b = boxMap.get(String(e.to))
    if (!a || !b || a.layer === b.layer) return
    const up = a.y <= b.y ? a : b, dn = a.y <= b.y ? b : a
    if (!starts.has(up)) starts.set(up, [])
    if (!ends.has(dn)) ends.set(dn, [])
    starts.get(up).push(i)
    ends.get(dn).push(i)
  })
  const portOff = new Map()
  for (const side of [starts, ends]) {
    for (const [box, list] of side) {
      const otherX = (i) => {
        const a = boxMap.get(String(edges[i].from)), b = boxMap.get(String(edges[i].to))
        const o = a === box ? b : a
        return o.x + o.w / 2
      }
      list.sort((p, q) => otherX(p) - otherX(q))
      const n = list.length
      const usable = Math.max(24, box.w - 44)
      const step = n > 1 ? Math.min(18, usable / (n - 1)) : 0
      list.forEach((i, k) => portOff.set(`${i}:${side === starts ? 's' : 'e'}`, (k - (n - 1) / 2) * step))
    }
  }

  const routes = []
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei]
    const a = boxMap.get(String(e.from)), b = boxMap.get(String(e.to))
    if (!a || !b) { routes.push(null); continue }

    if (a.layer === b.layer) {
      if (Math.abs(a.idx - b.idx) === 1) {
        const l = a.idx < b.idx ? a : b, r = a.idx < b.idx ? b : a
        routes.push({ d: `M${l.x + l.w},${l.y + l.h / 2} H${r.x}`, sb: String(a.node.id), eb: String(b.node.id) })
      } else {
        const ly = laneIn('r' + a.layer, rowStrip(a.layer))
        const sx = a.x + a.w / 2, tx = b.x + b.w / 2
        routes.push({ d: `M${sx},${a.y + a.h} V${ly} H${tx} V${b.y + b.h}`, sb: String(a.node.id), eb: String(b.node.id) })
      }
      continue
    }

    const up = a.y <= b.y ? a : b
    const dn = a.y <= b.y ? b : a
    const sx = up.x + up.w / 2 + (portOff.get(`${ei}:s`) || 0)
    const ex = dn.x + dn.w / 2 + (portOff.get(`${ei}:e`) || 0)
    const y0 = up.y + up.h, y1 = dn.y

    // adjacent rows: one turn, and the horizontal run sits in the only empty strip between them
    if (Math.abs(dn.layer - up.layer) === 1) {
      const mid = laneIn('g' + up.layer, gapStrip(up.layer))
      const d = Math.abs(sx - ex) < 1 ? `M${sx},${y0} V${y1}` : `M${sx},${y0} V${mid} H${ex} V${y1}`
      routes.push({ d, sb: String(up.node.id), eb: String(dn.node.id) })
      continue
    }

    // multi-row: pick ONE free column, descend through it the whole way
    const target = sx + (ex - sx) * 0.5
    let best = null, bestScore = Infinity
    for (const cx of columns) {
      if (!freeColumn(cx, up.layer + 1, dn.layer - 1)) continue
      const busy = usedCols.get(cx) || 0
      const score = Math.abs(cx - target) + busy * 90
      if (score < bestScore) { bestScore = score; best = cx }
    }
    if (best == null) best = target - ((target - X0) % (boxW + GAP_X)) + (boxW + GAP_X) / 2 - GAP_X / 2
    // a column holds one line; a second edge in the same column steps a few px aside, so the two
    // verticals stay two lines instead of reading as one
    const busy = usedCols.get(best) || 0
    let colX2 = best
    if (busy > 0) {
      const k = Math.ceil(busy / 2)
      const cand = best + (busy % 2 ? 1 : -1) * Math.min(13, k * 6)
      if (freeColumn(cand, up.layer + 1, dn.layer - 1)) colX2 = cand
    }
    usedCols.set(best, busy + 1)

    const gA = laneIn('g' + up.layer, gapStrip(up.layer))
    const gB = laneIn('g' + (dn.layer - 1), gapStrip(dn.layer - 1))
    const d = `M${sx},${y0} V${gA} H${colX2} V${gB} H${ex} V${y1}`
    routes.push({ d, sb: String(up.node.id), eb: String(dn.node.id) })
  }

  // ---- parse paths into axis-aligned segments ----
  const segsOf = (d) => {
    const out = []
    let cur = null
    for (const t of d.match(/[MHV][-\d.]+(,[-\d.]+)?/g) || []) {
      const cmd = t[0], nums = t.slice(1).split(',').map(Number)
      if (cmd === 'M') cur = { x: nums[0], y: nums[1] }
      else if (cmd === 'H') { if (nums[0] !== cur.x) out.push({ x1: cur.x, y1: cur.y, x2: nums[0], y2: cur.y }); cur = { x: nums[0], y: cur.y } }
      else if (cmd === 'V') { if (nums[0] !== cur.y) out.push({ x1: cur.x, y1: cur.y, x2: cur.x, y2: nums[0] }); cur = { x: cur.x, y: nums[0] } }
    }
    return out
  }
  routes.forEach((r, i) => {
    if (!r) return
    r.segs = segsOf(r.d)
    r.from = String(edges[i].from)
    r.to = String(edges[i].to)
    // a vertical right under the source / right above the target is a shared bus, not two edges
    for (const s of r.segs) s.box = null
    if (r.segs.length) {
      const f = r.segs[0], l = r.segs[r.segs.length - 1]
      if (Math.abs(f.x1 - f.x2) < 0.5) f.box = r.sb
      if (Math.abs(l.x1 - l.x2) < 0.5 && !l.box) l.box = r.eb
    }
  })

  const boxRects = () => [...boxMap.values()].map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, id: String(b.node.id) }))
  const BR = boxRects()
  const hitBox = (r, pad = 0) => BR.find((b) => r.x + r.w > b.x - pad && r.x < b.x + b.w + pad && r.y + r.h > b.y - pad && r.y < b.y + b.h + pad)

  // ---- labels: on their own line ----
  const placed = []
  const labelOf = new Map()
  const LBL_H = 12
  const candFor = (edge) => {
    const r = routes[edge]
    const text = String(edges[edge].label || '')
    if (!r || !text) return null
    const w = textW(text)
    const segs = [...r.segs].sort((p, q) => (Math.abs(q.x2 - q.x1) + Math.abs(q.y2 - q.y1)) - (Math.abs(p.x2 - p.x1) + Math.abs(p.y2 - p.y1)))
    let best = null, bestScore = Infinity
    for (const s of segs) {
      const vert = Math.abs(s.x1 - s.x2) < 0.5
      const len = vert ? Math.abs(s.y2 - s.y1) : Math.abs(s.x2 - s.x1)
      if (len < (vert ? 16 : w + 8)) continue
      const ts = [0.5, 0.34, 0.66, 0.2, 0.8, 0.42, 0.58, 0.12, 0.88]
      for (const t of ts) {
        const cx = s.x1 + (s.x2 - s.x1) * t
        const cy = s.y1 + (s.y2 - s.y1) * t
        // on the line first; if the line is crowded, step just beside it — the label carries the
        // line's colour, so a 7px offset still reads as "this label belongs to that line"
        const spots = vert
          ? [[cx, cy, 'middle', 0], [cx + w / 2 + 7, cy, 'start', 25], [cx - w / 2 - 7, cy, 'end', 25]]
          : [[cx, cy, 'middle', 0], [cx, cy + 14, 'middle', 25], [cx, cy - 12, 'middle', 25]]
        for (const [x, y, anchor, off] of spots) {
          const rect = { x: anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x, y: y - LBL_H / 2, w, h: LBL_H }
          let score = (s.box ? 150 : 0) + off
          if (hitBox(rect, 2)) score += 1000
          if (placed.some((o) => rect.x + rect.w > o.x - 2 && rect.x < o.x + o.w + 2 && rect.y + rect.h > o.y - 2 && rect.y < o.y + o.h + 2)) score += 400
          if (rect.x < 8 || rect.x + rect.w > width - 8) score += 300
          for (const b of bands) {
            for (const yy of [b.y, b.y + b.h]) if (Math.abs(rect.y + rect.h / 2 - yy) < 12 && rect.x + rect.w > b.x && rect.x < b.x + b.w) score += 1000
            if (b.title || b.note) {
              const tb = { x: b.x + 12, y: b.y + 8, w: 30 + textW(b.title) + (b.note ? 12 + textW(b.note) : 0), h: 18 }
              if (rect.x + rect.w > tb.x && rect.x < tb.x + tb.w && rect.y + rect.h > tb.y && rect.y < tb.y + tb.h) score += 500
            }
          }
          for (let j = 0; j < routes.length; j++) {
            if (j === edge || !routes[j]) continue
            if (routes[j].segs.some((o) => rect.x + rect.w > Math.min(o.x1, o.x2) - 3 && rect.x < Math.max(o.x1, o.x2) + 3 && rect.y + rect.h > Math.min(o.y1, o.y2) - 3 && rect.y < Math.max(o.y1, o.y2) + 3)) score += 60
          }
          score += Math.abs(t - 0.5) * 20
          if (score < bestScore) { bestScore = score; best = { rect, cx: x, cy: y, anchor, score } }
          if (bestScore === 0) break
        }
        if (bestScore === 0) break
      }
      if (bestScore === 0) break
    }
    return best
  }

  const order = edges.map((e, i) => i).filter((i) => e_label(i))
  function e_label(i) { return edges[i] && edges[i].label && routes[i] }
  order.sort((p, q) => (routes[p].segs.length - routes[q].segs.length) || (textW(edges[q].label) - textW(edges[p].label)))
  for (const i of order) {
    let c = candFor(i)
    if (!c) {
      // never drop a label: a missing label is silent loss of information, worse than a tight one
      const segs = [...routes[i].segs].sort((p, q) => (Math.abs(q.x2 - q.x1) + Math.abs(q.y2 - q.y1)) - (Math.abs(p.x2 - p.x1) + Math.abs(p.y2 - p.y1)))
      const s = segs[0]
      if (!s) continue
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2, w = textW(edges[i].label)
      c = { rect: { x: cx - w / 2, y: cy - LBL_H / 2, w, h: LBL_H }, cx, cy, score: 999 }
    }
    placed.push(c.rect)
    labelOf.set(i, { x: c.cx, y: c.cy, anchor: c.anchor || 'middle', w: c.rect.w, h: LBL_H, clean: c.score === 0 })
  }

  return { data, layers, bands, boxMap, routes, width, height, notes, notesTop, legendTop, perRow, boxW, X0, labelOf, placed, BR, hitBox, edgeColor, kindColor }
}

// ---------------- readability self-check ----------------
export function check(lay) {
  const v = [], warn = []
  const { routes, bands, width, height, notes, labelOf, data } = lay
  const edges = data.edges || []
  const boxes = [...lay.boxMap.values()].map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, id: String(b.node.id) }))
  const overlap = (r, b, pad = 0) => r.x + r.w > b.x - pad && r.x < b.x + b.w + pad && r.y + r.h > b.y - pad && r.y < b.y + b.h + pad

  routes.forEach((r, i) => {
    if (!r) return
    for (const s of r.segs) {
      const rect = { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1) || 1, h: Math.abs(s.y2 - s.y1) || 1 }
      const hit = boxes.find((b) => overlap(rect, b, -1))
      if (hit) v.push(`LINE_THROUGH_BOX edge#${i} ${edges[i].from}->${edges[i].to} box=${hit.id}`)
      for (const b of bands) {
        if (!b.title && !b.note) continue
        const t = { x: b.x + 12, y: b.y + 8, w: 30 + textW(b.title) + (b.note ? 12 + textW(b.note) : 0), h: 18 }
        if (overlap(rect, t, 1)) warn.push(`LINE_ON_TITLE edge#${i} ${edges[i].from}->${edges[i].to} band=${b.title || b.id}`)
      }
    }
    // horizontal runs must stay inside a band the edge actually touches
    const srcLayerBox = lay.boxMap.get(r.from), dstLayerBox = lay.boxMap.get(r.to)
    const ownBands = new Set([lay.layers[srcLayerBox.layer].band, lay.layers[dstLayerBox.layer].band])
    for (const s of r.segs) {
      if (Math.abs(s.y1 - s.y2) > 0.5) continue
      const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2)
      bands.forEach((b, bi) => {
        if (ownBands.has(bi)) return
        if (s.y1 > b.y + 6 && s.y1 < b.y + b.h - 4 && x2 > b.x && x1 < b.x + b.w) v.push(`LINE_IN_FOREIGN_BAND edge#${i} ${edges[i].from}->${edges[i].to} band=${b.title || b.id}`)
      })
    }
  })

  routes.forEach((r, i) => {
    const text = data.edges[i] && data.edges[i].label
    if (r && text && !labelOf.has(i)) v.push(`LABEL_MISSING edge#${i} "${text}"`)
  })

  const labs = []
  for (const [i, L] of labelOf) {
    const rect = { x: L.anchor === 'start' ? L.x : L.anchor === 'end' ? L.x - L.w : L.x - L.w / 2, y: L.y - L.h / 2, w: L.w, h: L.h }
    const hit = boxes.find((b) => overlap(rect, b, 1))
    if (hit) v.push(`LABEL_ON_BOX edge#${i} "${edges[i].label}" box=${hit.id}`)
    if (rect.x < 2 || rect.x + rect.w > width - 2 || rect.y < 2 || rect.y + rect.h > height - 2) v.push(`LABEL_CLIPPED edge#${i} "${edges[i].label}"`)
    for (const o of labs) if (overlap(rect, o, 1)) v.push(`LABEL_LABEL "${edges[i].label}" vs "${edges[o.i].label}"`)
    for (const b of bands) for (const yy of [b.y, b.y + b.h]) {
      if (Math.abs(L.y - yy) < L.h / 2 + 6 && rect.x + rect.w > b.x && rect.x < b.x + b.w) v.push(`LABEL_ON_BORDER edge#${i} "${edges[i].label}"`)
    }
    // band titles and notes are text too — a line or a label through them is unreadable
    for (const b of bands) {
      if (!b.title && !b.note) continue
      const box = { x: b.x + 12, y: b.y + 8, w: 30 + textW(b.title) + (b.note ? 12 + textW(b.note) : 0), h: 18 }
      if (overlap(rect, box, 2)) warn.push(`LABEL_ON_TITLE edge#${i} "${edges[i].label}" band=${b.title || b.id}`)
    }
    // must sit on its own path
    // a label may sit beside its line, but never far enough to be ambiguous
    const own = routes[i].segs.some((s) => {
      const dx = L.x < Math.min(s.x1, s.x2) ? Math.min(s.x1, s.x2) - L.x : L.x > Math.max(s.x1, s.x2) ? L.x - Math.max(s.x1, s.x2) : 0
      const dy = L.y < Math.min(s.y1, s.y2) ? Math.min(s.y1, s.y2) - L.y : L.y > Math.max(s.y1, s.y2) ? L.y - Math.max(s.y1, s.y2) : 0
      return Math.hypot(dx, dy) <= 18
    })
    if (!own) v.push(`LABEL_OFF_LINE edge#${i} "${edges[i].label}"`)
    labs.push({ ...rect, i })
  }

  // readability budget
  const n = (data.nodes || []).length, m = (data.edges || []).length

  // two edges drawn on the same line read as one edge — the worst kind of quiet bug
  for (let i = 0; i < routes.length; i++) {
    if (!routes[i]) continue
    for (let j = i + 1; j < routes.length; j++) {
      if (!routes[j]) continue
      for (const s of routes[i].segs) for (const t of routes[j].segs) {
        if (s.box && s.box === t.box) continue
        const tol = s.box || t.box ? 12 : 4
        const sh = Math.abs(s.y1 - s.y2) < 0.5, th = Math.abs(t.y1 - t.y2) < 0.5
        if (sh !== th) continue
        if (sh) {
          if (Math.abs(s.y1 - t.y1) < 0.5 && Math.min(Math.max(s.x1, s.x2), Math.max(t.x1, t.x2)) - Math.max(Math.min(s.x1, s.x2), Math.min(t.x1, t.x2)) > tol)
            v.push(`EDGES_MERGED edge#${i} and edge#${j} share the horizontal y=${Math.round(s.y1)}`)
        } else {
          if (Math.abs(s.x1 - t.x1) < 0.5 && Math.min(Math.max(s.y1, s.y2), Math.max(t.y1, t.y2)) - Math.max(Math.min(s.y1, s.y2), Math.min(t.y1, t.y2)) > tol)
            v.push(`EDGES_MERGED edge#${i} and edge#${j} share the vertical x=${Math.round(s.x1)}`)
        }
      }
    }
  }

  let cross = 0
  for (let i = 0; i < routes.length; i++) {
    if (!routes[i]) continue
    for (let j = i + 1; j < routes.length; j++) {
      if (!routes[j]) continue
      for (const s of routes[i].segs) for (const t of routes[j].segs) {
        const sh = Math.abs(s.y1 - s.y2) < 0.5, th = Math.abs(t.y1 - t.y2) < 0.5
        if (sh === th) continue
        const h = sh ? s : t, vv = sh ? t : s
        if (Math.min(h.x1, h.x2) < vv.x1 && Math.max(h.x1, h.x2) > vv.x1 && Math.min(vv.y1, vv.y2) < h.y1 && Math.max(vv.y1, vv.y2) > h.y1) cross++
      }
    }
  }
  const budget = { nodes: n, edges: m, crossings: cross, perRow: lay.perRow }
  if (cross > Math.max(10, m * 1.2)) v.push(`TOO_MANY_CROSSINGS ${cross} for ${m} edges`)
  if (m > n * 2) v.push(`TOO_MANY_EDGES ${m} edges for ${n} nodes`)

  return { violations: v, warnings: warn, budget }
}

export function svg(lay, theme, opts) {
  const TH = theme || {}
  const BG = TH.bg || '#ffffff'
  const BOXFILL = TH.box || '#f6f7f9'
  const BOXEDGE = TH.boxEdge || '#dde1e7'
  const INK = TH.ink || '#1c2128'
  const SUB = TH.sub || '#5b6672'
  const NOTE = TH.note || '#6b7683'
  const { bands, boxMap, routes, width, height, notes, labelOf, data } = lay
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const p = []
  p.push(`<svg width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%;height:auto">`)
  const colors = [...new Set(lay.edgeColor)]
  p.push(`<defs>${colors.map((c, i) => `<marker id="ar${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('')}</defs>`)
  for (const b of bands) {
    const c = toneOf(b.tone)
    p.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="none" stroke="${c}" stroke-opacity="0.55" stroke-width="1.2" stroke-dasharray="7 5"/>`)
    if (b.title) {
      const tw = 8 + textW(b.title) + (b.note ? 14 + textW(b.note) : 0)
      p.push(`<rect x="${b.x + 8}" y="${b.y + 5}" width="${tw}" height="21" rx="5" fill="${BG}"/>`)
    }
    if (b.title) p.push(`<text x="${b.x + 14}" y="${b.y + 22}" font-size="13" font-weight="600" fill="${c}">${esc(b.title)}</text>`)
    if (b.note) p.push(`<text x="${b.x + 26 + textW(b.title)}" y="${b.y + 22}" font-size="9.5" fill="${NOTE}">${esc(b.note)}</text>`)
  }
  // click a box to dim everything not connected to it — trees of lines collapse to one neighbourhood
  const hi = (opts && opts.hi) || ''
  const near = new Set()
  if (hi) {
    near.add(hi)
    for (const e of data.edges) {
      if (String(e.from) === hi) near.add(String(e.to))
      if (String(e.to) === hi) near.add(String(e.from))
    }
  }
  const dimEdge = (i) => hi && String(data.edges[i].from) !== hi && String(data.edges[i].to) !== hi

  // each line is drawn halo-then-colour, so at a crossing the later line visibly breaks the earlier
  // one — you can follow either line through a tangle without guessing
  routes.forEach((r, i) => {
    if (!r) return
    const c = lay.edgeColor[i], mk = `url(#ar${colors.indexOf(c)})`
    const op = dimEdge(i) ? ' opacity="0.1"' : ''
    p.push(`<g${op} data-e="${esc(String(data.edges[i].from))}|${esc(String(data.edges[i].to))}">`)
    // a relation that does not exist yet is drawn heavier: thickness is the one channel colour has not taken
    const w = data.edges[i].new ? 2.4 : 1.3
    p.push(`<path d="${r.d}" fill="none" stroke="${BG}" stroke-width="${(w + 3.3).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round"/>`)
    p.push(`<path d="${r.d}" fill="none" stroke="${c}" stroke-width="${w}" ${data.edges[i].dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round" marker-end="${mk}"/>`)
    p.push('</g>')
  })
  const box = boxMap
  const bandOfGroup = new Map(bands.map((b) => [b.id, b]))
  const anyNew = [...box.values()].some((b) => b.node.new)
  for (const b of box.values()) {
    const n = b.node
    const id = esc(String(n.id))
    const op = hi && !near.has(String(n.id)) ? ' opacity="0.32"' : ''
    // "already there" and "still to build" come from opposite sources, so the box says which it is
    const grp = bandOfGroup.get(String(n.group))
    const accent = n.new ? toneOf(grp ? grp.tone : 'plain') : null
    const stroke = hi === String(n.id) ? (TH.accent || '#1f6feb') : accent || BOXEDGE
    const sw = hi === String(n.id) ? 2 : n.new ? 1.9 : 1.2
    p.push(`<g data-n="${id}" style="cursor:pointer"${op}>`)
    p.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="7" fill="${BOXFILL}" stroke="${stroke}" stroke-width="${sw}"/>`)
    p.push(`<text x="${b.x + 13}" y="${b.y + 22}" font-size="13" font-weight="600" fill="${INK}">${esc(n.title || n.id)}</text>`)
    if (n.sub) p.push(`<text x="${b.x + 13}" y="${b.y + 40}" font-size="9.5" fill="${SUB}">${esc(n.sub)}</text>`)
    p.push('</g>')
  }
  for (const [i, L] of labelOf) {
    const op = dimEdge(i) ? ' opacity="0.1"' : ''
    p.push(`<text x="${L.x}" y="${L.y + 3.6}" font-size="10" text-anchor="${L.anchor}" fill="${lay.edgeColor[i]}" stroke="${BG}" stroke-width="3.4" paint-order="stroke" stroke-linejoin="round"${op}>${esc(data.edges[i].label)}</text>`)
  }
  notes.forEach((line, i) => p.push(`<text x="${6}" y="${lay.notesTop + 14 + i * 17}" font-size="9.5" fill="${SUB}">${esc(line)}</text>`))
  // legend: the picture explains its own colours, so nothing has to be remembered from outside
  let lx = 6
  for (const [kind, c] of lay.kindColor) {
    p.push(`<line x1="${lx}" y1="${lay.legendTop + 8}" x2="${lx + 22}" y2="${lay.legendTop + 8}" stroke="${c}" stroke-width="1.8"/>`)
    p.push(`<text x="${lx + 28}" y="${lay.legendTop + 11.5}" font-size="9.5" fill="${INK}">${esc(kind)}</text>`)
    lx += 28 + textW(kind) + 22
  }
  if (anyNew) {
    p.push(`<rect x="${lx}" y="${lay.legendTop + 3}" width="18" height="11" rx="3" fill="none" stroke="#1f6feb" stroke-width="1.9"/>`)
    p.push(`<text x="${lx + 25}" y="${lay.legendTop + 11.5}" font-size="9.5" fill="${INK}">${esc('本次新增')}</text>`)
    lx += 25 + textW('本次新增') + 22
  }
  if (data.edges.some((e) => e.new)) {
    p.push(`<line x1="${lx}" y1="${lay.legendTop + 8}" x2="${lx + 22}" y2="${lay.legendTop + 8}" stroke="#8b95a3" stroke-width="2.4"/>`)
    p.push(`<text x="${lx + 28}" y="${lay.legendTop + 11.5}" font-size="9.5" fill="${INK}">${esc('新增关系')}</text>`)
  }
  p.push('</svg>')
  return p.join('\n')
}

// ---------------- CLI ----------------
const isMain = process.argv[1] && process.argv[1].endsWith('layout.mjs')
if (isMain) {
  const [, , file, wArg, out] = process.argv
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const lay = layout(data, Number(wArg || 900))
  const { violations, warnings, budget } = check(lay)
  console.log(`size=${Math.round(lay.width)}x${Math.round(lay.height)} perRow=${lay.perRow} boxW=${lay.boxW}`)
  console.log(`budget=${JSON.stringify(budget)}`)
  console.log(warnings.length ? 'warn ' + warnings.join(' | ') : 'warnings=0')
  console.log(violations.length ? violations.join('\n') : 'violations=0')
  if (out) writeFileSync(out, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}</style></head><body>${svg(lay)}</body></html>`, 'utf8')
  process.exit(violations.length ? 1 : 0)
}
