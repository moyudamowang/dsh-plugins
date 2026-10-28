/**
 * Host half of the structure map.
 *
 * Read-only. Discovers `*.struct.json` files under every known project root and
 * serves them to the client panel:
 *
 *   GET /struct-map-list          → { ok, files: [{ file, name, mtime, size, root }] }
 *   GET /struct-map-data?file=…   → { ok, data, mtime }
 *
 * No write endpoint on purpose: the data file is edited by the agent as a normal
 * workspace file, so the change stays visible in the conversation.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

export const inject = ['webServer', 'timer']

const SUFFIX = '.struct.json'
const EXCLUDES = new Set([
  '.git', 'node_modules', '.godot', '.ai', '.worktrees', '.codegraph',
  'bin', 'obj', 'Library', 'Temp', 'logs', '.vs', '.idea', 'packages',
  'build', 'dist', '__pycache__', '.venv', 'venv', 'target', 'vendor', 'out', '.next', 'coverage',
])
const MAX_DEPTH = 7
const MAX_FILES = 200
const MAX_BYTES = 2 * 1024 * 1024
const ROOTS_TTL = 5000

function send(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function inside(root, abs) {
  const rel = path.relative(root, abs)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function apply(ctx, config = {}) {
  const extraRoots = Array.isArray(config.projectRoots) ? config.projectRoots.filter(Boolean) : []
  const maxFiles = Number(config.maxFiles) > 0 ? Number(config.maxFiles) : MAX_FILES
  const cache = { at: 0, roots: [] }

  function collectRoots() {
    if (Date.now() - cache.at < ROOTS_TTL) return cache.roots
    const found = new Map()
    const push = (p) => {
      if (!p) return
      try {
        const abs = path.resolve(String(p))
        if (existsSync(abs)) found.set(abs.toLowerCase(), abs)
      } catch {
        /* ignore a bad root */
      }
    }
    for (const r of extraRoots) push(r)
    try {
      const registry = ctx.get('workspaceRegistry')
      if (registry && typeof registry.list === 'function') {
        for (const ws of registry.list()) push(ws && (ws.path || ws.root || ws.dir || ws.cwd))
      }
    } catch {
      /* registry is optional */
    }
    cache.roots = [...found.values()]
    cache.at = Date.now()
    return cache.roots
  }

  function scan() {
    const roots = collectRoots()
    const out = []
    for (const root of roots) {
      const stack = [{ dir: root, depth: 0 }]
      while (stack.length && out.length < maxFiles) {
        const { dir, depth } = stack.pop()
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const entry of entries) {
          if (out.length >= maxFiles) break
          const abs = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (depth >= MAX_DEPTH) continue
            if (EXCLUDES.has(entry.name) || entry.name.startsWith('.')) continue
            stack.push({ dir: abs, depth: depth + 1 })
            continue
          }
          if (!entry.isFile() || !entry.name.endsWith(SUFFIX)) continue
          try {
            const st = statSync(abs)
            out.push({
              file: abs,
              name: path.relative(root, abs).replace(/\\/g, '/'),
              root,
              mtime: st.mtimeMs,
              size: st.size,
            })
          } catch {
            /* skip unreadable file */
          }
        }
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  function listHandler(_req, res) {
    send(res, 200, { ok: true, files: scan() })
  }

  function dataHandler(req, res) {
    let file = ''
    try {
      file = new URL(req.url, 'http://127.0.0.1').searchParams.get('file') || ''
    } catch {
      file = ''
    }
    if (!file) return send(res, 400, { ok: false, error: 'missing file' })
    const abs = path.resolve(file)
    if (!abs.endsWith(SUFFIX)) return send(res, 400, { ok: false, error: 'not a struct file' })
    const root = collectRoots().find((r) => inside(r, abs))
    if (!root) return send(res, 403, { ok: false, error: 'outside workspace' })
    let st
    try {
      st = statSync(abs)
    } catch {
      return send(res, 404, { ok: false, error: 'not found' })
    }
    if (st.size > MAX_BYTES) return send(res, 413, { ok: false, error: 'too large' })
    let data
    try {
      data = JSON.parse(readFileSync(abs, 'utf8'))
    } catch (err) {
      return send(res, 200, { ok: false, error: 'bad json: ' + String(err && err.message), mtime: st.mtimeMs })
    }
    send(res, 200, { ok: true, data, mtime: st.mtimeMs })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/struct-map-list', handler: listHandler }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/struct-map-data', handler: dataHandler }))
}
