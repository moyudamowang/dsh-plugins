// Host half of dsh-discussion-tree.
// Registers the global /tree command that applies manual edits from the GUI
// panel to the workspace discussion tree files, and manages per-session
// membership (state.json) under tmp/讨论树/.
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'

function result(kind, text) {
  return { kind, text, toString() { return text } }
}
const ok = (text) => result('success', text)
const err = (text) => result('error', text)

const SESSION_ID_RE = /^[\w][\w.-]{0,128}$/u

/** All node ids of the subtree rooted at rootId (inclusive). */
function subtreeIds(nodes, rootId) {
  const byParent = {}
  for (const n of nodes) {
    const p = (n.parent === null || n.parent === undefined) ? '__root__' : n.parent
    if (!byParent[p]) byParent[p] = []
    byParent[p].push(n.id)
  }
  const out = []
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()
    if (out.includes(id)) continue
    out.push(id)
    const kids = byParent[id] || []
    for (const k of kids) stack.push(k)
  }
  return out
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

function statePath(dir) {
  return join(dir, 'state.json')
}
function sessionFileRel(id) {
  return 'sessions/' + id + '.json'
}

/** Read state.json; null when missing or corrupt (caller falls back to legacy). */
async function readState(dir) {
  try {
    const parsed = JSON.parse(await readFile(statePath(dir), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.sessions || typeof parsed.sessions !== 'object') parsed.sessions = {}
    if (typeof parsed.default !== 'string') parsed.default = 'off'
    return parsed
  } catch {
    return null
  }
}

async function writeState(dir, state) {
  await mkdir(dir, { recursive: true })
  await writeFile(statePath(dir), JSON.stringify(state, null, 2) + '\n', 'utf8')
}

/** Resolve which file a session's tree lives in, first existing wins. */
async function resolveTreeFile(dir, state, id) {
  const entry = state.sessions[id]
  if (entry && typeof entry.treeFile === 'string') return entry.treeFile
  const own = sessionFileRel(id)
  if (await exists(join(dir, own))) return own
  return 'tree.json'
}

/** Strict source resolution for migrate: null when the session has no tree of its own. */
async function resolveSource(dir, state, id) {
  const entry = state.sessions[id]
  if (entry && typeof entry.treeFile === 'string') return entry.treeFile
  const own = sessionFileRel(id)
  if (await exists(join(dir, own))) return own
  return null
}

function upsertEntry(state, id, patch) {
  const prev = state.sessions[id] || {}
  state.sessions[id] = { ...prev, ...patch, at: Date.now() }
  return state.sessions[id]
}

function markActive(state, id, treeFile) {
  state.active = { session: id, treeFile, at: Date.now() }
}

function freshTree(sessionId) {
  return {
    title: '讨论主线',
    current: '',
    nodes: [],
    _session: sessionId,
  }
}

export function apply(ctx) {
  ctx.inject(['commands'], (cctx) => {
    const commands = cctx.commands
    if (!commands || typeof commands.register !== 'function') return
    const unregister = commands.register({
      definitionId: 'dsh-discussion-tree',
      name: 'tree',
      description: '讨论树维护（GUI 面板调用）：{"op":"remove|status|initState|init|inherit|detach|shareBack|migrate|adoptShared|enable|disable",...}',
      input: { hint: 'remove/status 带 path+id；init/inherit/detach/shareBack/migrate/adoptShared/enable/disable 带 dir+session（inherit/migrate 另带 from；inherit 可带 as=share|copy）' },
      handler: async (invocation) => {
        let req
        try {
          req = JSON.parse(invocation.rawInput)
        } catch {
          return err('参数不是合法 JSON')
        }
        if (!req || typeof req.op !== 'string') return err('缺少 op')
        const op = req.op

        // ── node-level ops operate on an absolute tree file path ──
        if (op === 'remove' || op === 'status') {
          if (typeof req.path !== 'string' || !req.id) return err('缺少 path 或 id')
          let tree
          try {
            tree = JSON.parse(await readFile(req.path, 'utf8'))
          } catch (e) {
            return err('读不到 ' + req.path + '：' + String((e && e.message) || e))
          }
          const nodes = Array.isArray(tree.nodes) ? tree.nodes : []
          if (op === 'remove') {
            const doomed = subtreeIds(nodes, req.id)
            if (!doomed.includes(req.id)) return err('没有找到节点 ' + req.id)
            const survivors = nodes.filter((n) => !doomed.includes(n.id))
            if (doomed.includes(tree.current)) {
              const target = nodes.find((n) => n.id === req.id)
              const parent = target ? target.parent : null
              tree.current = (parent !== null && parent !== undefined && !doomed.includes(parent))
                ? parent
                : (survivors.length ? survivors[0].id : '')
            }
            tree.nodes = survivors
            try {
              await writeFile(req.path, JSON.stringify(tree, null, 2) + '\n', 'utf8')
            } catch (e) {
              return err('写入失败：' + String((e && e.message) || e))
            }
            return ok('已移除 ' + doomed.join('、'))
          }
          const node = nodes.find((n) => n.id === req.id)
          if (!node) return err('没有找到节点 ' + req.id)
          node.status = req.status === 'done' ? 'done' : 'open'
          node.manual = true
          try {
            await writeFile(req.path, JSON.stringify(tree, null, 2) + '\n', 'utf8')
          } catch (e) {
            return err('写入失败：' + String((e && e.message) || e))
          }
          return ok(node.id + (node.status === 'done' ? ' 已标记已答' : ' 已重开'))
        }

        // ── membership ops operate on the 讨论 tree directory ──
        if (op === 'initState' || op === 'init' || op === 'inherit' || op === 'detach' || op === 'shareBack' || op === 'migrate' || op === 'adoptShared' || op === 'enable' || op === 'disable' || op === 'bindRecorder' || op === 'unbindRecorder' || op === 'setRecite') {
          if (typeof req.dir !== 'string' || !req.session) return err('缺少 dir 或 session')
          if (!SESSION_ID_RE.test(String(req.session))) return err('session id 不合法')
          const dir = req.dir
          const S = String(req.session)
          const state = (await readState(dir)) || { version: 1, default: 'off', sessions: {} }

          if (op === 'initState') {
            // Legacy → managed: this session keeps the shared tree so the view does not jump.
            const sharedExists = await exists(join(dir, 'tree.json'))
            const treeFile = sharedExists ? 'tree.json' : sessionFileRel(S)
            upsertEntry(state, S, { enabled: true, treeFile, source: 'shared' })
            markActive(state, S, treeFile)
            if (!sharedExists) {
              await mkdir(join(dir, dirname(sessionFileRel(S))), { recursive: true })
              await writeFile(join(dir, treeFile), JSON.stringify(freshTree(S), null, 2) + '\n', 'utf8')
            }
            await writeState(dir, state)
            return ok('已切换为按会话管理（本会话沿用共享树）')
          }

          if (op === 'init') {
            const rel = sessionFileRel(S)
            const abs = join(dir, rel)
            if (!(await exists(abs))) {
              await mkdir(dirname(abs), { recursive: true })
              await writeFile(abs, JSON.stringify(freshTree(S), null, 2) + '\n', 'utf8')
            }
            upsertEntry(state, S, { enabled: true, treeFile: rel, source: 'fresh' })
            markActive(state, S, rel)
            await writeState(dir, state)
            return ok('已为本会话开启空白讨论树')
          }

          if (op === 'inherit') {
            // fork 的子会话第一次打开面板时走这里：把父会话的归属照搬过来，一次，不覆盖已有选择。
            const from = String(req.from || '')
            if (!from || !SESSION_ID_RE.test(from)) return err('缺少或来源 session 不合法')
            if (state.sessions[S]) return ok('本会话已有讨论树归属，未改动')

            const parent = state.sessions[from]
            // 父会话自己没有归属（面板上就是"未开启"）→ 子会话也留在未开启，别替它挑一棵树
            if (!parent) return err('父会话 ' + from + ' 还没有讨论树归属，本会话保持未开启')
            const parentFile = (typeof parent.treeFile === 'string')
              ? parent.treeFile
              : (await exists(join(dir, sessionFileRel(from))) ? sessionFileRel(from) : 'tree.json')

            // 父会话自己把树关了 → 子会话照样关着，别替它做主
            if (parent && parent.enabled === false) {
              upsertEntry(state, S, { enabled: false, treeFile: parentFile, source: 'fork-closed', inheritedFrom: from })
              await writeState(dir, state)
              return ok('父会话已关闭讨论树，本会话保持关闭（可手动开启）')
            }

            const as = req.as === 'copy' ? 'copy' : 'share'
            if (as === 'copy' && (await exists(join(dir, parentFile)))) {
              const rel = sessionFileRel(S)
              await mkdir(dirname(join(dir, rel)), { recursive: true })
              await copyFile(join(dir, parentFile), join(dir, rel))
              upsertEntry(state, S, { enabled: true, treeFile: rel, source: 'fork-copy', inheritedFrom: from })
              markActive(state, S, rel)
              await writeState(dir, state)
              return ok('已从 ' + from + ' 复制一份独立讨论树（' + rel + '）')
            }

            // share：父用共享树就共用共享树；父用自己的私有树就挂到那份文件上接着用，
            // 这样记录员还在维护它，子会话看到的不是会过期的快照。
            const usable = parentFile === 'tree.json' || (await exists(join(dir, parentFile)))
            if (!usable) {
              // 不写 state：让子会话留在 onboard，人还能自己开树或挂共享树
              return err('父会话 ' + from + ' 没有可继承的讨论树（' + parentFile + ' 不存在）')
            }
            upsertEntry(state, S, {
              enabled: true,
              treeFile: parentFile,
              source: parentFile === 'tree.json' ? 'fork-shared' : 'fork-join',
              inheritedFrom: from,
            })
            markActive(state, S, parentFile)
            await writeState(dir, state)
            return ok('已接着 ' + from + ' 的讨论树用（' + parentFile + '）')
          }

          if (op === 'detach') {
            // 想把分支单独拉出去时用：把当前树复制成自己的一份，之后各长各的
            const entry = state.sessions[S]
            const cur = (entry && typeof entry.treeFile === 'string') ? entry.treeFile : (await resolveTreeFile(dir, state, S))
            if (cur === sessionFileRel(S)) return ok('本会话已经在用独立讨论树（' + cur + '）')
            if (!(await exists(join(dir, cur)))) return err('当前讨论树文件不存在（' + cur + '）')
            const rel = sessionFileRel(S)
            await mkdir(dirname(join(dir, rel)), { recursive: true })
            await copyFile(join(dir, cur), join(dir, rel))
            upsertEntry(state, S, { enabled: true, treeFile: rel, source: 'detached', detachedFrom: cur })
            markActive(state, S, rel)
            await writeState(dir, state)
            return ok('已另存为独立讨论树（' + rel + '），之后与 ' + cur + ' 互不影响')
          }

          if (op === 'shareBack') {
            // detach 的反向：从独立副本改回跟别人共用一份。来源可能是会话 id，也可能是当初
            // 复制自的文件路径（detachedFrom 记的是文件），两种都要能回得去。
            const entry = state.sessions[S] || {}
            const isSess = (v) => typeof v === 'string' && v.indexOf('session-') === 0 && SESSION_ID_RE.test(v)
            const hint = String(entry.inheritedFrom || entry.detachedFrom || '')
            const from = isSess(req.from) ? String(req.from) : (isSess(hint) ? hint : '')

            let target = 'tree.json'
            if (!from && hint.endsWith('.json')) target = hint
            else if (from) {
              const pe = state.sessions[from]
              if (pe && typeof pe.treeFile === 'string') target = pe.treeFile
              else if (await exists(join(dir, sessionFileRel(from)))) target = sessionFileRel(from)
            }

            if (!(await exists(join(dir, target)))) return err('要共用的树不存在（' + target + '）')
            const cur = String(entry.treeFile || '')
            if (cur === target) return ok('本来就在共用 ' + target)
            upsertEntry(state, S, { enabled: true, treeFile: target, source: from ? 'fork-join' : 'shared' })
            if (from) state.sessions[S].inheritedFrom = from
            markActive(state, S, target)
            await writeState(dir, state)
            return ok('已改回共用（' + target + '），自己的那份副本仍留在磁盘上')
          }

          if (op === 'migrate') {
            if (!req.from || !SESSION_ID_RE.test(String(req.from))) return err('缺少或来源 session 不合法')
            const from = String(req.from)
            const fromRel = await resolveSource(dir, state, from)
            if (!fromRel) return err('来源会话 ' + from + ' 没有独立讨论树（想共用工作区树请用「使用工作区共享树」）')
            const fromAbs = join(dir, fromRel)
            if (!(await exists(fromAbs))) return err('来源会话没有讨论树（' + fromRel + '）')
            const rel = sessionFileRel(S)
            const abs = join(dir, rel)
            await mkdir(dirname(abs), { recursive: true })
            await copyFile(fromAbs, abs)
            upsertEntry(state, S, { enabled: true, treeFile: rel, source: 'migrated', migratedFrom: from })
            markActive(state, S, rel)
            await writeState(dir, state)
            return ok('已从 ' + from + ' 迁移讨论树到本会话（' + rel + '）')
          }

          if (op === 'adoptShared') {
            if (!(await exists(join(dir, 'tree.json')))) return err('工作区还没有共享树 tree.json')
            upsertEntry(state, S, { enabled: true, treeFile: 'tree.json', source: 'shared' })
            markActive(state, S, 'tree.json')
            await writeState(dir, state)
            return ok('本会话已挂到工作区共享树')
          }

          if (op === 'bindRecorder') {
            if (!req.recorder || !SESSION_ID_RE.test(String(req.recorder))) return err('recorder 会话 id 不合法')
            const mine = state.sessions[S]
            const treeFile = (mine && mine.treeFile) ? mine.treeFile : 'tree.json'
            if (!state.recorders || typeof state.recorders !== 'object') state.recorders = {}
            if (state.recorder && state.recorder.sessionId && !state.recorders['tree.json']) {
              state.recorders['tree.json'] = state.recorder // 旧全局槽迁移:原有绑定归主共享树
            }
            state.recorders[treeFile] = { sessionId: String(req.recorder), at: Date.now() }
            if (treeFile === 'tree.json') state.recorder = state.recorders[treeFile] // 旧字段镜像共享树,兼容旧客户端
            await writeState(dir, state)
            return ok('已为 ' + treeFile + ' 绑定记录会话 ' + req.recorder)
          }

          if (op === 'unbindRecorder') {
            const mine = state.sessions[S]
            const treeFile = (mine && mine.treeFile) ? mine.treeFile : 'tree.json'
            if (state.recorders && typeof state.recorders === 'object') delete state.recorders[treeFile]
            if (treeFile === 'tree.json') delete state.recorder
            await writeState(dir, state)
            return ok('已解绑 ' + treeFile + ' 的记录会话')
          }

          if (op === 'setRecite') {
            // 自动复述开关:按树记在 state.recite[treeFile];摘要的组装与投递都在客户端
            const mine = state.sessions[S]
            const treeFile = (mine && mine.treeFile) ? mine.treeFile : 'tree.json'
            if (!state.recite || typeof state.recite !== 'object') state.recite = {}
            if (req.enabled) state.recite[treeFile] = { enabled: true, at: Date.now() }
            else delete state.recite[treeFile]
            await writeState(dir, state)
            return ok(req.enabled
              ? '已开启 ' + treeFile + ' 的自动复述:记录员更新树后会自动把主线摘要投给本会话'
              : '已关闭 ' + treeFile + ' 的自动复述')
          }

          if (op === 'enable' || op === 'disable') {
            const entry = state.sessions[S]
            if (!entry) return err('本会话还没有讨论树记录，请先开启')
            entry.enabled = op === 'enable'
            entry.at = Date.now()
            if (op === 'enable') {
              if (!entry.treeFile) entry.treeFile = (await exists(join(dir, sessionFileRel(S)))) ? sessionFileRel(S) : 'tree.json'
              markActive(state, S, entry.treeFile)
            }
            await writeState(dir, state)
            return ok(op === 'enable' ? '本会话讨论树已重新开启' : '本会话讨论树已关闭')
          }
        }

        return err('未知 op：' + op)
      },
    })
    ctx.effect(() => () => {
      if (typeof unregister === 'function') unregister()
    }, 'discussion-tree: /tree command')
  })

  // ---- 模型工具:主线感知(说明即规则,随插件携带,不落项目文件) -----------
  ctx.inject(['tools'], (tctx) => {
    const tools = tctx.tools
    if (!tools || typeof tools.register !== 'function') return
    const unregisterTool = tools.register({
      name: 'discussion_tree',
      description: [
        '主线话题树感知(本工作区含 tmp/讨论树/ 时使用)。',
        '规则:开工或接手新任务前先调一次 status,看主线 current 在哪个节点下,对齐主线再动手;',
        '讨论出现新定案、换了工作内容、或原有设计落地成实物,把一句话摘要投给 status 返回的 recorder 会话(没有跨会话工具就提醒用户在「主线」面板点唤醒);',
        '树与右侧「主线」标签同源,分歧以树为准。',
        'input: {action:"status", dir:"工作区根目录绝对路径"}——dir 缺省时退回环境变量 DSH_DISCUSSION_TREE_DIR,再缺省则报错让调用者补传。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status'] },
          dir: { type: 'string', description: '工作区根目录绝对路径' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_input, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      execute: async (input) => {
        const dir = (input && typeof input.dir === 'string' && input.dir.trim()) || process.env.DSH_DISCUSSION_TREE_DIR || ''
        if (!dir) {
          return { ok: false, error: '缺 dir:传工作区根目录绝对路径(讨论树在 <dir>/tmp/讨论树/)' }
        }
        const treeDir = join(dir, 'tmp', '讨论树')
        let tree
        try {
          tree = JSON.parse(await readFile(join(treeDir, 'tree.json'), 'utf8'))
        } catch {
          return { ok: false, exists: false, hint: '本工作区没有讨论树(tmp/讨论树/tree.json 不存在或不可读),忽略本工具即可' }
        }
        const nodes = Array.isArray(tree.nodes) ? tree.nodes : []
        const byId = {}
        for (const n of nodes) byId[n.id] = n
        const pathOf = (id) => {
          const out = []
          let n = byId[id]
          let guard = 0
          while (n && guard++ < 64) {
            out.unshift(n.id)
            n = (n.parent !== null && n.parent !== undefined) ? byId[n.parent] : null
          }
          return out.join(' → ')
        }
        const current = tree.current ? byId[tree.current] || null : null
        const hanging = nodes
          .filter((n) => n.status !== 'done' && n.parent !== null && n.parent !== undefined)
          .map((n) => n.id)
        let recorder = null
        try {
          const st = JSON.parse(await readFile(join(treeDir, 'state.json'), 'utf8'))
          // 按树绑定(v0.5.6+):主线感知读共享树的记录员;旧全局字段兜底
          const recs = (st && st.recorders && typeof st.recorders === 'object') ? st.recorders : null
          const shared = (recs && recs['tree.json'] && recs['tree.json'].sessionId) || null
          recorder = shared || (st && st.recorder && st.recorder.sessionId) || null
        } catch { /* state.json 缺失时 recorder 保持 null */ }
        return {
          ok: true,
          title: tree.title || '讨论主线',
          current: current
            ? { id: current.id, title: current.title, status: current.status, path: pathOf(current.id) }
            : null,
          hanging,
          recorder,
          total: nodes.length,
          nodes: nodes.map((n) => ({ id: n.id, parent: n.parent === undefined ? null : n.parent, title: n.title, status: n.status, manual: !!n.manual })),
        }
      },
    })
    ctx.effect(() => () => {
      if (typeof unregisterTool === 'function') unregisterTool()
    }, 'discussion-tree: discussion_tree tool')
  })
}
