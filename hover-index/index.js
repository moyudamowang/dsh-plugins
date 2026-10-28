/**
 * Host half of the hover index — project-agnostic.
 *
 * Serves `/hover-index?name=<symbol>`:
 *   1. for every known project root, query that project's codegraph SQLite index (if it has one),
 *   2. check freshness against the source file's mtime and re-read the file when the row is stale,
 *   3. on a miss, scan the workspace directly (works without any index, covers GDScript and friends),
 *   4. enrich the first few hits with the declaration line, caller count and inheritance.
 *
 * Project roots come from the durable workspace registry, plus optional `projectRoots` config.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

// `node:sqlite` exists from Node 22.5 on. Load it defensively: without it the
// plugin still works, only the index fast path is unavailable.
const require = createRequire(import.meta.url)
let DatabaseSync = null
try {
  ;({ DatabaseSync } = require('node:sqlite'))
} catch {
  DatabaseSync = null
}

export const inject = ['webServer', 'timer']

const DEFAULT_EXCLUDES = [
  '.git', '.codegraph', '.godot', 'node_modules', '.worktrees', '.gen', '.ai',
  'bin', 'obj', 'Library', 'Temp', 'logs', '.vs', '.idea', 'packages', 'build', 'dist',
  '__pycache__', '.venv', 'venv', 'target', 'vendor', 'out', '.next', '.nuxt', 'coverage',
]
const SCAN_EXT = new Set(['.cs', '.gd', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.rs', '.go', '.java', '.kt', '.lua'])
const FILE_EXT = new Set([
  ...SCAN_EXT, '.json', '.md', '.tscn', '.cfg', '.txt', '.yml', '.yaml', '.toml', '.shader', '.gdshader',
])
const NAME_RE = /^[A-Za-z_$][\w.$]{1,80}$/
const FILE_RE = /^([A-Za-z_][\w.@\/-]*\.(?:cs|gd|ts|tsx|js|jsx|mjs|py|rs|go|java|kt|lua|json|md|tscn|cfg|txt|yml|yaml|toml|shader|gdshader))(?::(\d+))?$/i

const CACHE_TTL = 5000
const ROOTS_TTL = 5000
const SYMBOL_TTL = 4000
const FILE_TTL = 8000
const DEFAULT_MAX_ITEMS = 12
const MAX_ENRICH = 3

const GD_DECL = [
  [/^\s*(?:static\s+)?func\s+([A-Za-z_]\w*)/, 'func'],
  [/^\s*(?:@[A-Za-z_]\w*(?:\([^)]*\))?\s+)*(?:static\s+)?var\s+([A-Za-z_]\w*)/, 'var'],
  [/^\s*const\s+([A-Za-z_]\w*)/, 'const'],
  [/^\s*signal\s+([A-Za-z_]\w*)/, 'signal'],
  [/^\s*class_name\s+([A-Za-z_]\w*)/, 'class'],
  [/^\s*enum\s+([A-Za-z_]\w*)/, 'enum'],
]

const CS_WORDS =
  /\b(?:public|private|protected|internal|static|readonly|const|override|virtual|async|void|class|struct|interface|enum|record|Task|int|string|bool|float|double|long|byte|char|object|decimal)\b/

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanDoc(text) {
  return String(text || '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/^\s*\/\/\/+/gm, ' ')
    .replace(/^\s*##?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

function docAbove(lines, index) {
  if (!lines || index <= 0) return ''
  const collected = []
  let i = index - 1
  let blanks = 0
  while (i >= 0) {
    const t = String(lines[i] || '').trim()
    if (!t) {
      blanks++
      if (collected.length > 0 || blanks > 1) break
      i--
      continue
    }
    const isDoc =
      t.startsWith('///') ||
      t.startsWith('//') ||
      t.startsWith('/*') ||
      t.startsWith('*') ||
      t.startsWith('##') ||
      t.startsWith('#')
    if (!isDoc) break
    collected.unshift(t)
    i--
  }
  return cleanDoc(collected.join('\n'))
}

function walk(dir, root, exts, skip, out, depth) {
  if (depth > 24) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue
      walk(abs, root, exts, skip, out, depth + 1)
    } else if (entry.isFile() && exts.has(path.extname(entry.name))) {
      out.push(abs)
    }
  }
}

function collect(root, exts, skipNames) {
  const skip = new Set([...DEFAULT_EXCLUDES, ...(skipNames || [])])
  const out = []
  walk(root, root, exts, skip, out, 0)
  return out
}

function buildSymbolMap(root, skipNames) {
  const map = new Map()
  for (const abs of collect(root, new Set(['.gd']), skipNames)) {
    let text
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(root, abs).replace(/\\/g, '/')
    const lines = text.split(/\r?\n/)
    const addSym = (name, kind, lineNo, doc) => {
      if (!name) return
      const entry = { kind, rel, abs, line: lineNo, doc: doc || '' }
      const list = map.get(name)
      if (list) list.push(entry)
      else map.set(name, [entry])
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line || line.trimStart().startsWith('#')) continue
      for (const [re, kind] of GD_DECL) {
        const m = re.exec(line)
        if (!m) continue
        addSym(m[1], kind, i + 1, docAbove(lines, i))
        if (kind === 'func') {
          const params = /^[^(]*\(([^)]*)\)/.exec(line)
          if (params) {
            for (const raw of params[1].split(',')) {
              const paramName = raw.trim().split('=')[0].split(':')[0].trim()
              if (/^[A-Za-z_]\w*$/.test(paramName)) addSym(paramName, 'param', i + 1, '')
            }
          }
        }
        break
      }
    }
  }
  return map
}

function buildFileIndex(root, skipNames) {
  const map = new Map()
  for (const abs of collect(root, FILE_EXT, skipNames)) {
    const rel = path.relative(root, abs).replace(/\\/g, '/')
    const key = path.basename(rel).toLowerCase()
    const list = map.get(key)
    if (list) list.push({ rel, abs })
    else map.set(key, [{ rel, abs }])
  }
  return map
}

function rankOf(file) {
  const isTest = /SelfTest|Tests?\//.test(file) ? 1 : 0
  const area = file.startsWith('Project/ProjectLogic/')
    ? 0
    : file.startsWith('Project/')
      ? 1
      : file.startsWith('AstroFramework/')
        ? 2
        : 3
  return area * 2 + isTest
}

function compareItems(a, b) {
  const ra = rankOf(a.file)
  const rb = rankOf(b.file)
  if (ra !== rb) return ra - rb
  if (a.file !== b.file) return a.file < b.file ? -1 : 1
  return a.line - b.line
}

/** Generic declaration matchers per language family. */
function matchersFor(name, ext) {
  const n = esc(name)
  const common = {
    typed: new RegExp(`\\b(?:class|struct|interface|enum|record|trait|type|object)\\s+${n}\\b`),
    fn: new RegExp(`\\b(?:function|func|fn|def|sub)\\s+${n}\\b`),
    call: new RegExp(`\\b${n}\\s*(?:<[^<>]*>)?\\s*\\(`),
    assign: new RegExp(`^\\s*(?:const|let|var|export\\s+const|export\\s+let|export\\s+var)\\s+${n}\\s*(?::[^=]+)?=`),
    field: new RegExp(`^\\s*(?:private|public|protected|internal|static|readonly|final)?\\s*[\\w.<>,\\[\\]\\?]+\\s+${n}\\s*(?:;|=|\\{)`),
    param: new RegExp(`\\([^)]*\\b[A-Za-z_][\\w.<>,\\[\\]\\?]*\\s+${n}\\s*(?:,|\\))`),
  }
  return common
}

function classifyLine(ext, line, matchers) {
  const t = line.trim()
  if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return null
  if (/^(?:return|throw|await|yield|using|new|import|from)\b/.test(t)) return null
  if (matchers.typed.test(line)) return 'class'
  if (matchers.fn.test(line)) return 'func'
  if (ext === '.py') return t.startsWith('@') ? null : null
  if (matchers.assign.test(line)) return 'var'
  if (ext === '.cs' && matchers.call.test(line) && CS_WORDS.test(line)) return 'method'
  if (matchers.call.test(line) && /(?:=>|\{)\s*$/.test(t)) return 'method'
  if (matchers.param.test(line)) return 'param'
  if (ext === '.cs' && matchers.field.test(line) && CS_WORDS.test(line)) return 'field'
  if (matchers.field.test(line)) return 'field'
  return null
}

function scanFiles(state) {
  if (Date.now() - state.scanList.at > FILE_TTL) {
    try {
      state.scanList = { at: Date.now(), list: collect(state.root, SCAN_EXT, state.exclude) }
    } catch {
      state.scanList = { at: Date.now(), list: [] }
    }
  }
  return state.scanList.list
}

function scanWorkspace(state, name) {
  const hits = []
  const matchers = matchersFor(name)
  const started = Date.now()
  let visited = 0
  for (const abs of scanFiles(state)) {
    if (hits.length >= state.maxItems * 2) break
    if (Date.now() - started > state.scanBudgetMs) break
    if (++visited > state.maxScanFiles) break
    if (abs.endsWith('.gd')) continue // covered by the symbol map
    let info
    try {
      info = statSync(abs)
    } catch {
      continue
    }
    if (!info.isFile() || info.size > 2_000_000) continue
    let text
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    if (!text.includes(name)) continue
    const ext = path.extname(abs)
    const rel = path.relative(state.root, abs).replace(/\\/g, '/')
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const kind = classifyLine(ext, lines[i], matchers)
      if (!kind) continue
      hits.push({
        name,
        kind,
        file: rel,
        line: i + 1,
        qualified: '',
        doc: docAbove(lines, i),
        abs,
        origin: 'scan',
        root: state.root,
        rootLabel: state.label,
      })
    }
  }
  return hits.sort(compareItems).slice(0, state.maxItems)
}

function readSourceLine(abs, lineNo) {
  try {
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    return (lines[lineNo - 1] || '').trim().slice(0, 200)
  } catch {
    return ''
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Same-origin guard: browsers stamp `sec-fetch-site`; anything else is refused. */
function requestAllowed(req) {
  const site = req.headers && req.headers['sec-fetch-site']
  if (!site) return true
  return site === 'same-origin' || site === 'none'
}

function resolveCodeCli() {
  const candidates = []
  for (const dir of String(process.env.PATH || '').split(';')) {
    if (!dir) continue
    candidates.push(path.join(dir, 'code.cmd'))
    candidates.push(path.join(dir, 'code.exe'))
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'))
  }
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'bin', 'code.cmd'))
  }
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      /* keep looking */
    }
  }
  return null
}

export function apply(ctx, config = {}) {
  const maxItems = Number(config.maxItems) > 0 ? Number(config.maxItems) : DEFAULT_MAX_ITEMS
  const extraRoots = Array.isArray(config.projectRoots) ? config.projectRoots.filter(Boolean) : []
  const autoDiscover = config.autoDiscover !== false
  const autoSync = config.autoSync === true
  const scanUnindexed = config.scanUnindexed === true
  const maxScanFiles = Number(config.maxScanFiles) > 0 ? Number(config.maxScanFiles) : 20000
  const scanBudgetMs = Number(config.scanBudgetMs) > 0 ? Number(config.scanBudgetMs) : 1200
  const extraExcludes = Array.isArray(config.excludeDirs) ? config.excludeDirs.filter(Boolean) : []
  const codeCli = resolveCodeCli()

  const states = new Map()
  const rootsCache = { at: 0, list: [] }
  const syncMarks = new Map()

  function resolveRoots() {
    if (Date.now() - rootsCache.at < ROOTS_TTL) return rootsCache.list
    const found = new Map()
    const push = (candidate) => {
      if (!candidate) return
      const abs = path.resolve(candidate)
      const key = process.platform === 'win32' ? abs.toLowerCase() : abs
      if (found.has(key)) return
      try {
        if (statSync(abs).isDirectory()) found.set(key, abs)
      } catch {
        /* missing directory */
      }
    }
    for (const root of extraRoots) push(root)
    if (autoDiscover) {
      const registry = ctx.get('workspaceRegistry')
      if (registry && typeof registry.list === 'function') {
        try {
          for (const workspace of registry.list()) push(workspace.path)
        } catch {
          /* registry unavailable */
        }
      }
    }
    if (found.size === 0) push(process.cwd())
    rootsCache.list = [...found.values()]
    rootsCache.at = Date.now()
    return rootsCache.list
  }

  function stateFor(root) {
    let state = states.get(root)
    if (!state) {
      state = {
        root,
        label: path.basename(root),
        maxItems,
        exclude: extraExcludes,
        db: null,
        dbError: '',
        dbTried: false,
        indexed: false,
        symbol: { at: 0, map: new Map() },
        files: { at: 0, map: new Map() },
        scanList: { at: 0, list: [] },
        maxScanFiles,
        scanBudgetMs,
        names: new Map(),
      }
      states.set(root, state)
    }
    return state
  }

  function ensureDb(state) {
    if (state.dbTried) return state.db
    state.dbTried = true
    const dbPath = path.join(state.root, '.codegraph', 'codegraph.db')
    try {
      if (existsSync(dbPath)) {
        state.indexed = true
        state.db = new DatabaseSync(dbPath, { readOnly: true })
        try {
          state.db.exec('PRAGMA busy_timeout = 2000')
        } catch {
          /* pragma is best effort */
        }
      }
    } catch (err) {
      state.dbError = String((err && err.message) || err)
    }
    return state.db
  }

  function symbolMap(state) {
    if (Date.now() - state.symbol.at > SYMBOL_TTL) {
      try {
        state.symbol = { at: Date.now(), map: buildSymbolMap(state.root, state.exclude) }
      } catch {
        state.symbol = { at: Date.now(), map: new Map() }
      }
    }
    return state.symbol.map
  }

  function fileIndex(state) {
    if (Date.now() - state.files.at > FILE_TTL) {
      try {
        state.files = { at: Date.now(), map: buildFileIndex(state.root, state.exclude) }
      } catch {
        state.files = { at: Date.now(), map: new Map() }
      }
    }
    return state.files.map
  }

  function queryDb(state, name) {
    const stmt = state.db.prepare(
      `SELECT n.id AS id, n.name AS name, n.kind AS kind, n.file_path AS file, n.start_line AS line,
              n.qualified_name AS qualified, n.signature AS signature, n.docstring AS doc,
              f.modified_at AS modifiedAt
         FROM nodes n LEFT JOIN files f ON f.path = n.file_path
        WHERE n.name = ? ORDER BY n.start_line LIMIT ?`,
    )
    return stmt.all(name, maxItems * 2)
  }

  function isStale(state, row) {
    try {
      const info = statSync(path.join(state.root, row.file))
      return info.mtimeMs > (row.modifiedAt ?? 0) + 1500
    } catch {
      return true
    }
  }

  function baseItem(state, row) {
    const rel = String(row.file).replace(/\\/g, '/')
    return {
      name: row.name,
      kind: row.kind,
      file: rel,
      line: row.line,
      qualified: row.qualified ?? '',
      doc: cleanDoc(row.doc),
      abs: path.join(state.root, rel.replace(/\//g, path.sep)),
      origin: 'db',
      root: state.root,
      rootLabel: state.label,
      nodeId: row.id,
    }
  }

  function enrich(state, item) {
    if (item.origin !== 'db' || !state.db || !item.nodeId) return item
    try {
      const callers = state.db
        .prepare("SELECT COUNT(*) AS c FROM edges WHERE target = ? AND kind = 'calls'")
        .get(item.nodeId)
      const count = Number(callers && callers.c) || 0
      if (count > 0) {
        item.callers = {
          count,
          top: state.db
            .prepare(
              "SELECT n.name AS name FROM edges e JOIN nodes n ON n.id = e.source WHERE e.target = ? AND e.kind = 'calls' LIMIT 3",
            )
            .all(item.nodeId)
            .map((row) => row.name),
        }
      }
      if (item.kind === 'class' || item.kind === 'interface' || item.kind === 'struct') {
        const parents = state.db
          .prepare(
            "SELECT t.name AS name, e.kind AS kind FROM edges e JOIN nodes t ON t.id = e.target WHERE e.source = ? AND e.kind IN ('extends','implements') LIMIT 4",
          )
          .all(item.nodeId)
        if (parents.length) item.inherits = parents
      }
    } catch {
      /* enrichment is optional */
    }
    if (!item.decl) item.decl = readSourceLine(item.abs, item.line)
    return item
  }

  function maybeAutoSync(state) {
    if (!autoSync) return
    const now = Date.now()
    const last = syncMarks.get(state.root) ?? 0
    if (now - last < 60000) return
    syncMarks.set(state.root, now)
    try {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'codegraph', 'sync'], {
        cwd: state.root,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
    } catch {
      /* sync is best effort */
    }
  }

  function lookupRoot(state, name, allowScan) {
    const cacheKey = name + (allowScan ? '|scan' : '|db')
    const hit = state.names.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value

    const items = []
    const notes = []
    const db = ensureDb(state)
    let rows = []
    if (db) {
      try {
        rows = queryDb(state, name)
      } catch (err) {
        notes.push('db:' + String((err && err.message) || err))
      }
    } else if (state.dbError) {
      notes.push('db:' + state.dbError)
    }

    const fresh = []
    const stale = []
    for (const row of rows) (isStale(state, row) ? stale : fresh).push(row)
    for (const row of fresh) items.push(baseItem(state, row))

    const matchers = matchersFor(name)
    for (const row of stale) {
      const abs = path.join(state.root, String(row.file).replace(/\//g, path.sep))
      let text = ''
      try {
        text = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      if (!text.includes(name)) continue
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(name)) continue
        const kind = classifyLine(path.extname(abs), lines[i], matchers)
        if (!kind) continue
        items.push({
          name,
          kind,
          file: String(row.file).replace(/\\/g, '/'),
          line: i + 1,
          qualified: row.qualified ?? '',
          doc: docAbove(lines, i),
          abs,
          origin: 'verify',
          root: state.root,
          rootLabel: state.label,
          decl: lines[i].trim().slice(0, 200),
        })
        break
      }
    }
    if (stale.length > 0) {
      notes.push('stale:' + stale.length)
      maybeAutoSync(state)
    }

    if (items.length === 0) {
      const map = symbolMap(state)
      const gd = map.get(name) ?? []
      for (const entry of gd) {
        items.push({
          name,
          kind: entry.kind,
          file: entry.rel,
          line: entry.line,
          qualified: '',
          doc: entry.doc || '',
          abs: entry.abs,
          origin: 'scan',
          root: state.root,
          rootLabel: state.label,
        })
      }
      if (allowScan) items.push(...scanWorkspace(state, name))
    }

    const seen = new Set()
    const unique = []
    for (const item of items) {
      const key = `${item.root}:${item.file}:${item.line}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(item)
    }

    const value = { items: unique.sort(compareItems).slice(0, maxItems), notes }
    if (state.names.size > 500) state.names.clear()
    state.names.set(cacheKey, { at: Date.now(), value })
    return value
  }

  function fileLookupAll(name) {
    const m = FILE_RE.exec(name)
    if (!m) return []
    const wanted = m[1]
    const lineNo = m[2] ? Math.max(1, Number(m[2])) : 1
    const out = []
    for (const root of resolveRoots()) {
      const state = stateFor(root)
      if (wanted.includes('/')) {
        const abs = path.join(root, wanted.replace(/\//g, path.sep))
        try {
          if (statSync(abs).isFile()) {
            out.push(fileItem(state, wanted.replace(/\\/g, '/'), abs, lineNo))
          }
        } catch {
          /* missing */
        }
        continue
      }
      const list = (fileIndex(state).get(wanted.toLowerCase()) ?? []).slice(0, 3)
      for (const entry of list) out.push(fileItem(state, entry.rel, entry.abs, lineNo))
    }
    return out.sort(compareItems).slice(0, maxItems * 2)
  }

  function fileItem(state, rel, abs, lineNo) {
    return {
      name: path.basename(rel),
      kind: 'file',
      file: rel,
      line: lineNo,
      qualified: '',
      doc: '',
      abs,
      origin: 'scan',
      root: state.root,
      rootLabel: state.label,
    }
  }

  function lookup(name) {
    if (FILE_RE.test(name)) {
      return { items: fileLookupAll(name), notes: ['file'], roots: resolveRoots().length }
    }
    const roots = resolveRoots()
    const collectPass = (allowScan) => {
      const found = []
      const log = []
      for (const root of roots) {
        try {
          const state = stateFor(root)
          ensureDb(state)
          // A multi-project setup only scans indexed projects unless asked otherwise:
          // unindexed roots are the slow path and usually not what the chat is about.
          const canScan = allowScan && (scanUnindexed || state.indexed || roots.length === 1)
          const result = lookupRoot(state, name, canScan)
          found.push(...result.items)
          log.push(...result.notes)
        } catch (err) {
          log.push('root:' + String((err && err.message) || err))
        }
      }
      return { found, log }
    }

    // Pass 1: indexes and cached symbol maps only — cheap. Pass 2 scans sources,
    // and only when no index answered, so indexed projects stay fast.
    let pass = collectPass(false)
    const hasIndexed = pass.found.some((item) => item.origin === 'db' || item.origin === 'verify')
    if (!hasIndexed) pass = collectPass(true)
    const items = pass.found
    const notes = pass.log

    const seen = new Set()
    const unique = []
    for (const item of items) {
      const key = `${item.root}:${item.file}:${item.line}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(item)
    }
    const sorted = unique.sort(compareItems).slice(0, maxItems)
    for (let i = 0; i < Math.min(MAX_ENRICH, sorted.length); i++) enrich(stateFor(sorted[i].root), sorted[i])
    return { items: sorted, notes, roots: roots.length }
  }

  function handler(req, res) {
    if (!requestAllowed(req)) {
      send(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    let name = ''
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      name = (url.searchParams.get('name') || '').trim()
    } catch {
      send(res, 400, { ok: false, error: 'bad-url' })
      return
    }
    if (!NAME_RE.test(name) && !FILE_RE.test(name)) {
      send(res, 400, { ok: false, error: 'bad-name' })
      return
    }
    const started = Date.now()
    try {
      const result = lookup(name)
      send(res, 200, { ok: true, query: name, ...result, tookMs: Date.now() - started })
    } catch (err) {
      send(res, 500, { ok: false, error: String((err && err.message) || err) })
    }
  }

  function openHandler(req, res) {
    if (!requestAllowed(req)) {
      send(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    let file = ''
    let line = 1
    let root = ''
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      file = (url.searchParams.get('file') || '').trim()
      line = Number(url.searchParams.get('line') || '1')
      root = (url.searchParams.get('root') || '').trim()
    } catch {
      send(res, 400, { ok: false, error: 'bad-url' })
      return
    }
    if (!file || !Number.isFinite(line) || line < 1) {
      send(res, 400, { ok: false, error: 'bad-args' })
      return
    }
    const base = root || resolveRoots()[0] || process.cwd()
    const baseAbs = path.resolve(base)
    const abs = path.resolve(baseAbs, file)
    if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) {
      send(res, 400, { ok: false, error: 'outside-project' })
      return
    }
    try {
      if (!statSync(abs).isFile()) {
        send(res, 404, { ok: false, error: 'missing-file' })
        return
      }
    } catch {
      send(res, 404, { ok: false, error: 'missing-file' })
      return
    }
    if (!codeCli) {
      send(res, 500, { ok: false, error: 'editor-cli-not-found' })
      return
    }
    try {
      const child = spawn(
        process.env.ComSpec || 'cmd.exe',
        ['/c', 'call', codeCli, '-g', `${abs}:${line}`],
        { windowsHide: true, detached: true, stdio: 'ignore' },
      )
      child.unref()
      send(res, 200, { ok: true, file: abs, line })
    } catch (err) {
      send(res, 500, { ok: false, error: String((err && err.message) || err) })
    }
  }

  function rootsHandler(req, res) {
    if (!requestAllowed(req)) {
      send(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    send(res, 200, { ok: true, roots: resolveRoots() })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/hover-index', handler }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/hover-index-open', handler: openHandler }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/hover-index-roots', handler: rootsHandler }))

  ctx.timeout(() => {
    try {
      for (const root of resolveRoots()) symbolMap(stateFor(root))
    } catch {
      /* warmup is best effort */
    }
  }, 1500)
}
