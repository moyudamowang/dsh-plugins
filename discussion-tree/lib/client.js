window.__ModuleLoader__.load({
  id: 'dsh-discussion-tree',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var STYLE_ID = 'dsh-discussion-tree-style'
    var DIR_REL = 'tmp/讨论树'
    var LEGACY_TREE = 'tree.json'
    var STATE_FILE = 'state.json'
    var POLL_MS = 2000
    var TAB_ID = 'dsh-discussion-tree'
    var KIND = 'discussion-tree'
    var VERSION = 'v0.5.11'
    /** Stable empty list so selectors never mint a fresh array per snapshot. */
    var EMPTY_IDS = []

    /**
     * Activation context, captured in apply(). The remote namespace faces are
     * NOT read eagerly: `ctx.remote.workspaceFiles` resolves through the
     * context's service table and throws while the namespace is still being
     * mounted, which fails the whole fiber. Official tab types read the
     * carrier eagerly (guaranteed by inject) and the namespace lazily.
     */
    var CTX = null

    function workspaceFiles() {
      try { return (CTX.remote && CTX.remote.workspaceFiles) || null } catch (e) { return null }
    }

    function commandRemote() {
      try { return (CTX.remote && CTX.remote.commands) || null } catch (e) { return null }
    }

    function sessionRemote() {
      try { return (CTX.remote && CTX.remote.session) || null } catch (e) { return null }
    }

    function randomId() {
      try { return crypto.randomUUID() } catch (e) {
        return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
      }
    }

    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return
      var css = [
        '.dt-root{padding:10px 12px;font:12.5px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow:auto;height:100%}',
        '.dt-head{margin-bottom:10px}',
        '.dt-top{display:flex;align-items:center;gap:6px;margin-bottom:2px}',
        '.dt-badge{flex:none;font-size:10px;padding:0 6px;border-radius:9px;color:#5b7fa6;background:rgba(91,127,166,.16);white-space:nowrap}',
        '.dt-spacer{flex:1}',
        '.dt-path{font-size:11.5px;opacity:.62;word-break:break-all}',
        '.dt-warn{font-size:11.5px;color:#c08a2e;margin-top:2px}',
        '.dt-meta{font-size:11px;opacity:.5;margin-top:2px}',
        '.dt-row{display:flex;align-items:baseline;gap:6px;padding:2px 4px;border-radius:4px}',
        '.dt-row:hover{background:rgba(127,127,127,.1)}',
        '.dt-row.dt-cur{background:rgba(80,140,200,.16)}',
        '.dt-id{flex:none;min-width:30px;font-size:10.5px;opacity:.55;font-variant-numeric:tabular-nums}',
        '.dt-title{flex:1 1 auto}',
        '.dt-row.dt-cur .dt-title{font-weight:600}',
        '.dt-act{flex:none;display:flex;gap:4px;opacity:0;transition:opacity .12s}',
        '.dt-row:hover .dt-act,.dt-row:focus-within .dt-act{opacity:1}',
        '.dt-btn{flex:none;font-size:10px;padding:0 6px;border-radius:6px;border:none;background:rgba(127,127,127,.14);color:inherit;cursor:pointer;line-height:18px}',
        '.dt-btn.dt-danger{color:#a33;background:rgba(163,51,51,.12)}',
        '.dt-btn.dt-confirm{color:#fff;background:#a33}',
        '.dt-btn.dt-primary{color:#2a62a8;background:rgba(80,120,200,.18)}',
        '.dt-btn:disabled{opacity:.4;cursor:default}',
        '.dt-big{font-size:12px;padding:3px 10px;line-height:20px;margin:4px 6px 4px 0}',
        '.dt-fold{flex:none;width:14px;border:none;background:none;color:inherit;cursor:pointer;opacity:.5;font-size:10px;padding:0;line-height:18px}',
        '.dt-fold:hover{opacity:1}',
        '.dt-tag{flex:none;font-size:10px;padding:0 6px;border-radius:9px;white-space:nowrap}',
        '.dt-tag.dt-open{color:#b4761f;background:rgba(180,118,31,.14)}',
        '.dt-tag.dt-done{color:#3f7a4f;background:rgba(63,122,79,.14)}',
        '.dt-tag.dt-manual{color:#5b7fa6;background:rgba(91,127,166,.16)}',
        '.dt-ans{font-size:11.5px;opacity:.6;margin:0 0 5px}',
        '.dt-empty{opacity:.6;font-size:12px}',
        '.dt-err{font-size:12px;color:#b05a5a}',
        '.dt-err small{display:block;opacity:.65;margin-top:4px;word-break:break-all}',
        '.dt-banner{font-size:11.5px;padding:4px 8px;border-radius:6px;margin-bottom:8px;word-break:break-all}',
        '.dt-banner.dt-ok{color:#3f7a4f;background:rgba(63,122,79,.12)}',
        '.dt-banner.dt-error{color:#b05a5a;background:rgba(176,90,90,.12)}',
        '.dt-onboard{padding:8px 0}',
        '.dt-rec{margin-top:10px;padding-top:8px;border-top:1px solid rgba(127,127,127,.15)}',
        '.dt-recrow{display:flex;gap:6px;align-items:center;font-size:11.5px;flex-wrap:wrap}',
        '.dt-reclabel{flex:none;opacity:.55;font-size:11px}',
        '.dt-sel{flex:0 1 auto;min-width:0;max-width:100%;font-size:11px;padding:1px 4px;border-radius:6px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit}',
        '.dt-hint{font-size:11.5px;opacity:.7;margin:6px 0;word-break:break-all}',
        '.dt-foot{margin-top:12px;font-size:10.5px;opacity:.42;word-break:break-all}',
      ].join('\n')
      var el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = css
      document.head.appendChild(el)
    }

    function shortId(id) {
      var s = String(id || '')
      return s.length > 22 ? s.slice(0, 14) + '…' + s.slice(-6) : s
    }

    function fmtTime(ms) {
      var d = new Date(ms)
      function p(n) { return (n < 10 ? '0' : '') + n }
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }

    function joinPath(cwd, rel) {
      return cwd.replace(/[\\/]+$/, '') + '/' + rel
    }

    /** Line-paged read of one file; resolves { ok, text?, error?, code? }. */
    function readFileAll(sessionId, absPath) {
      var WF = workspaceFiles()
      if (!WF) return Promise.resolve({ ok: false, error: { message: 'remote.workspaceFiles 服务不可用' } })
      var text = ''
      var offset = 1
      var pages = 0
      function page() {
        return WF.read(sessionId, absPath, { offset: offset }, new AbortController().signal).then(function (result) {
          if (!result || result.ok !== true) {
            var e = (result && result.error) || {}
            return { ok: false, error: e.message || '读取失败', code: e.code || '' }
          }
          text += (text ? '\n' : '') + result.value.text
          pages += 1
          if (result.value.eof || pages > 50) return { ok: true, text: text }
          offset += result.value.lines
          return page()
        })
      }
      return page()
    }

    /**
     * Poll state.json (membership). Missing/corrupt → { state: null } (legacy
     * mode). Other failures carry an error for the inline warn line.
     */
    function useWsState(sessionId, cwd) {
      var s = useState({ loading: true, state: null, error: null, at: 0 })
      var snap = s[0]
      var setSnap = s[1]
      useEffect(function () {
        if (!sessionId || !cwd) { setSnap({ loading: false, state: null, error: null, at: 0 }); return undefined }
        var alive = true
        var generation = 0
        var absPath = joinPath(cwd, DIR_REL + '/' + STATE_FILE)
        function tick() {
          var g = ++generation
          readFileAll(sessionId, absPath).then(function (r) {
            if (!alive || g !== generation) return
            if (!r.ok) {
              var missing = /not[-_]?found|ENOENT|no such file/i.test((r.code || '') + ' ' + (r.error || ''))
              setSnap({ loading: false, state: null, error: missing ? null : (r.error || '读取失败'), at: Date.now() })
              return
            }
            try {
              var state = JSON.parse(r.text)
              setSnap({ loading: false, state: state && typeof state === 'object' ? state : null, error: null, at: Date.now() })
            } catch (e2) {
              setSnap({ loading: false, state: null, error: 'state.json 不是合法 JSON：' + String((e2 && e2.message) || e2), at: Date.now() })
            }
          })
        }
        tick()
        var timer = setInterval(tick, POLL_MS)
        return function () {
          alive = false
          clearInterval(timer)
        }
      }, [sessionId, cwd])
      return snap
    }

    /** Poll the session's resolved tree file. */
    function useTree(sessionId, cwd, treeFile) {
      var s = useState({ phase: 'loading' })
      var snap = s[0]
      var setSnap = s[1]
      useEffect(function () {
        if (!sessionId || !cwd || !treeFile) { setSnap({ phase: 'empty' }); return undefined }
        var alive = true
        var generation = 0
        var absPath = joinPath(cwd, DIR_REL + '/' + treeFile)
        function tick() {
          var g = ++generation
          readFileAll(sessionId, absPath).then(function (r) {
            if (!alive || g !== generation) return
            if (!r.ok) {
              var missing = /not[-_]?found|ENOENT|no such file/i.test((r.code || '') + ' ' + (r.error || ''))
              setSnap({ phase: missing ? 'missing' : 'error', error: r.error || '读取失败', code: r.code || '', absPath: absPath, at: Date.now() })
              return
            }
            try {
              var tree = JSON.parse(r.text)
              setSnap({ phase: 'ok', data: tree, absPath: absPath, at: Date.now() })
            } catch (e2) {
              setSnap({ phase: 'badjson', error: String((e2 && e2.message) || e2), absPath: absPath, at: Date.now() })
            }
          })
        }
        tick()
        var timer = setInterval(tick, POLL_MS)
        return function () {
          alive = false
          clearInterval(timer)
        }
      }, [sessionId, cwd, treeFile])
      return snap
    }

    /** One-shot probe: does the fork parent have a per-session tree? */
    function useForkProbe(active, sessionId, cwd, parentSessionId) {
      var s = useState('idle')
      var state = s[0]
      var set = s[1]
      useEffect(function () {
        if (!active || !parentSessionId || !sessionId || !cwd) { set('idle'); return undefined }
        var alive = true
        set('probing')
        readFileAll(sessionId, joinPath(cwd, DIR_REL + '/sessions/' + parentSessionId + '.json')).then(function (r) {
          if (alive) set(r.ok ? 'found' : 'missing')
        })
        return function () { alive = false }
      }, [active, sessionId, cwd, parentSessionId])
      return state
    }

    function indexPath(nodes) {
      var byId = {}
      var kids = {}
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]
        byId[n.id] = n
        var p = (n.parent === null || n.parent === undefined) ? '__root__' : n.parent
        if (!kids[p]) kids[p] = []
        kids[p].push(n)
      }
      return { byId: byId, kids: kids }
    }

    function pathOf(byId, id) {
      var out = []
      var n = byId[id]
      var guard = 0
      while (n && guard++ < 64) {
        out.unshift(n.id)
        n = n.parent ? byId[n.parent] : null
      }
      return out.join(' → ')
    }

    /** Normalize a generated-remote reply into { kind, text }. */
    function unwrap(r) {
      if (r === undefined || r === null) {
        return { kind: 'error', text: '命令没有返回（/tree 未注册？需要重启 DSH 载入新版）' }
      }
      if (typeof r.ok === 'boolean') {
        if (!r.ok) return { kind: 'error', text: (r.error && r.error.message) || '命令失败' }
        var v = r.value
        if (v && (v.kind === 'success' || v.kind === 'error')) return v
        if (v && v.result) return v.result
        return { kind: 'success', text: '已完成' }
      }
      if (r.kind === 'success' || r.kind === 'error') return r
      return { kind: 'error', text: '无法识别的命令返回' }
    }

    function row(n, depth, current, ui) {
      var kids = ui.kids[n.id]
      var hasKids = !!(kids && kids.length)
      var collapsed = !!ui.collapsed[n.id]
      var cls = 'dt-row' + (n.id === current ? ' dt-cur' : '')
      var confirming = ui.confirmId === n.id
      var actions = []
      if (hasKids) {
        actions.push(h('button', {
          key: 'fold',
          className: 'dt-fold',
          title: collapsed ? '展开子节点' : '折叠子节点',
          onClick: function () { ui.onFold(n.id) },
        }, collapsed ? '▸' : '▾'))
      }
      actions.push(h('button', {
        key: 'st',
        className: 'dt-btn',
        disabled: ui.busy,
        title: n.status === 'done' ? '重新开启这个问题' : '标记为已答',
        onClick: function () { ui.onStatus(n) },
      }, n.status === 'done' ? '重开' : '标答'))
      actions.push(h('button', {
        key: 'rm',
        className: 'dt-btn dt-danger' + (confirming ? ' dt-confirm' : ''),
        disabled: ui.busy,
        title: hasKids ? '移除该节点及其全部子节点' : '移除该节点',
        onClick: function () { ui.onRemove(n, hasKids) },
      }, confirming ? (hasKids ? '确认连同子节点?' : '确认移除?') : '移除'))
      var tags = [
        h('span', { key: 'st', className: 'dt-tag ' + (n.status === 'done' ? 'dt-done' : 'dt-open') },
          n.status === 'done' ? '已答' : '进行中'),
      ]
      if (n.manual) {
        tags.push(h('span', { key: 'mn', className: 'dt-tag dt-manual', title: '手动节点，自动侧只读' }, '手'))
      }
      return h('div', { key: n.id },
        h('div', { className: cls, style: { paddingLeft: (4 + depth * 16) + 'px' } },
          h('span', { className: 'dt-id' }, n.id),
          h('span', { className: 'dt-title' }, n.title),
          h('span', { className: 'dt-act' }, actions),
          tags),
        n.answer ? h('div', {
          className: 'dt-ans',
          style: { paddingLeft: (40 + depth * 16) + 'px' },
        }, n.answer) : null)
    }

    function walk(kids, nodes, depth, current, out, ui) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]
        out.push(row(n, depth, current, ui))
        if (ui.collapsed[n.id]) continue
        var sub = kids[n.id]
        if (sub && sub.length) walk(kids, sub, depth + 1, current, out, ui)
      }
      return out
    }

    function TreeBody(props) {
      ensureStyle()
      var sessionId = props ? props.sessionId : null
      var useSessions = props ? props.useSessions : null
      var cwd = null
      var parentSessionId = null
      var ids = []
      var byId = {}
      if (typeof useSessions === 'function') {
        cwd = useSessions(function (sessions) {
          var rec = (sessions && sessions.byId && sessionId) ? sessions.byId[sessionId] : null
          return rec ? rec.cwd : null
        })
        parentSessionId = useSessions(function (sessions) {
          var rec = (sessions && sessions.byId && sessionId) ? sessions.byId[sessionId] : null
          return rec && rec.parentSessionId ? rec.parentSessionId : null
        })
        ids = useSessions(function (sessions) { return (sessions && sessions.ids) || [] })
        byId = useSessions(function (sessions) { return (sessions && sessions.byId) || {} })
      }
      // The session list itself carries no archive flag: archival lives in the
      // workspace registry, which the framework hands every slot component as
      // the global useWorkspaces hook. Absent hook → degrade to unfiltered.
      var useWorkspaces = props ? props.useWorkspaces : null
      var archivedIds = EMPTY_IDS
      if (typeof useWorkspaces === 'function') {
        archivedIds = useWorkspaces(function (snap) {
          return (snap && snap.archivedSessionIds) || EMPTY_IDS
        })
      }
      // 本会话所属工作区 id:与 ui-workspace 同款判法——在 items[].sessionIds
      // 里反查。派生记录员时传 workspaceId 让宿主正式 attachSession 入籍;
      // 只传 cwd 会话能跑但入不了工作区,侧栏会把它归到别处。
      var currentWsId = null
      if (typeof useWorkspaces === 'function') {
        currentWsId = useWorkspaces(function (snap) {
          if (!snap || !Array.isArray(snap.items) || !sessionId) return null
          for (var i = 0; i < snap.items.length; i++) {
            var item = snap.items[i]
            if (item && Array.isArray(item.sessionIds) && item.sessionIds.indexOf(sessionId) !== -1) {
              return item.workspaceId || null
            }
          }
          return null
        })
      }
      var dirAbs = cwd ? joinPath(cwd, DIR_REL) : null
      var ws = useWsState(sessionId, cwd)

      // Resolve this session's mode from state.json.
      var entry = (ws.state && ws.state.sessions && sessionId) ? ws.state.sessions[sessionId] : null
      var mode
      var treeFile = null
      if (!ws.state) mode = 'legacy'
      else if (entry && entry.enabled === false) mode = 'closed'
      else if (entry && entry.enabled) {
        mode = 'on'
        treeFile = entry.treeFile || 'sessions/' + sessionId + '.json'
      } else mode = 'onboard'
      if (mode === 'legacy') treeFile = LEGACY_TREE

      var tree = useTree(sessionId, cwd, (mode === 'legacy' || mode === 'on') ? treeFile : null)
      var forkProbe = useForkProbe(mode === 'onboard', sessionId, cwd, parentSessionId)

      // ── fork 继承(v0.5.11):新会话第一次打开面板就接着父会话的树，不用人点 ──
      // 只在 onboard(本会话没有任何归属)时跑一次；一旦跑过、或人自己选了开启空白/共享，
      // localStorage 记一笔，之后不再干预——继承是默认，不是覆盖人的选择。
      var forkKey = 'dt-fork-inherit:' + (sessionId || '?')
      var forkTriedState = useState(false)
      var forkTried = forkTriedState[0]
      var setForkTried = forkTriedState[1]
      function forkMark() { try { localStorage.setItem(forkKey, '1') } catch (e) { /* 隐私模式 */ } }
      useEffect(function () {
        if (mode !== 'onboard' || !parentSessionId || !sessionId || !cwd || forkTried) return
        var done = false
        try { done = localStorage.getItem(forkKey) === '1' } catch (e) { done = false }
        if (done) return
        forkMark()
        setForkTried(true)
        memOp('inherit', { from: parentSessionId })
      }, [mode, parentSessionId, sessionId, cwd])

      // ── 主线同步(v0.5.10):对齐主线 + 自动复述 ─────────────────────────
      // digest 在客户端组装(树数据本来就全量轮询),投递走 session.prompt 到
      // 本会话自己。复述水位存 localStorage(收过哪版就不再重发);开关存
      // state.json 的 state.recite[treeFile],按树记住、所有挂这棵树的会话共享。
      var alignBusyState = useState(false)
      var alignBusy = alignBusyState[0]
      var setAlignBusy = alignBusyState[1]

      function treeStamp() {
        if (!tree.data) return null
        var ns = tree.data.nodes || []
        var last = ns.length ? ns[ns.length - 1].id : '-'
        return ns.length + ':' + last + ':' + (tree.data.current || '-')
      }

      function reciteWmKey() {
        return 'dt-recite-wm:' + (sessionId || '?') + ':' + (treeFile || LEGACY_TREE)
      }
      function readWm() {
        try { return localStorage.getItem(reciteWmKey()) || '' } catch (e) { return '' }
      }
      function writeWm(v) {
        try { localStorage.setItem(reciteWmKey(), v) } catch (e) { /* 丢水位顶多重发一次 */ }
      }

      function buildDigest() {
        if (!tree.data) return null
        var ns = tree.data.nodes || []
        var byId = {}
        for (var i = 0; i < ns.length; i++) byId[ns[i].id] = ns[i]
        var chain = []
        var n = tree.data.current ? byId[tree.data.current] : null
        var guard = 0
        while (n && guard++ < 64) {
          chain.unshift(n.id + ' ' + n.title)
          n = n.parent ? byId[n.parent] : null
        }
        var hang = ns.filter(function (x) { return x.status !== 'done' && x.parent !== null && x.parent !== undefined })
        var recent = ns.slice(-3)
        var lines = []
        lines.push('主线「' + (tree.data.title || '讨论主线') + '」当前位置:' + (chain.length ? chain.join(' → ') : '(空)'))
        lines.push('悬挂:' + (hang.length ? hang.map(function (x) { return x.id + ' ' + x.title }).join(' ; ') : '无'))
        lines.push('最近节点:' + (recent.length ? recent.map(function (x) { return x.id + ' ' + x.title }).join(' ; ') : '无'))
        lines.push('数据源 ' + (treeAbs || (dirAbs ? dirAbs + '/' + LEGACY_TREE : '')) + '(共 ' + ns.length + ' 节点)。此摘要由「主线」面板投递;动手前先对齐这段脉络,别把话头带偏。')
        return lines.join('\n')
      }

      /** Queue the digest into THIS session's own context. Resolves true on success. */
      function pushDigest(auto) {
        var svc = sessionRemote()
        if (!svc || typeof svc.prompt !== 'function') {
          flash('error', 'session.prompt 通道不可用(需要重启 DSH 载入新版)')
          return Promise.resolve(false)
        }
        var body = buildDigest()
        if (!body) { flash('error', '树还没就绪,没法对齐'); return Promise.resolve(false) }
        var head = auto ? '[主线复述] 记录员刚更新了讨论树,自动重投一段最新脉络:\n\n' : '[主线对齐] '
        var tz = ''
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { /* keep empty */ }
        return svc.prompt({
          requestId: randomId(),
          sessionId: sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: head + body }],
          clientTimeZone: tz || undefined,
        }).then(function (r) {
          if (r && r.ok) return true
          flash('error', (r && r.error && r.error.message) || '投递失败')
          return false
        }).catch(function (e) {
          flash('error', String((e && e.message) || e))
          return false
        })
      }

      function alignNow() {
        setAlignBusy(true)
        var stampNow = treeStamp()
        pushDigest(false).then(function (sent) {
          setAlignBusy(false)
          if (sent) {
            if (stampNow) writeWm(stampNow)
            flash('ok', '已把主线摘要投进本会话,下一轮就能看到')
          }
        })
      }

      function toggleRecite() {
        memOp('setRecite', { enabled: !reciteOn })
      }

      var reciteOn = false
      if (ws.state && ws.state.recite && typeof ws.state.recite === 'object') {
        var reciteSlot = ws.state.recite[treeFile || LEGACY_TREE]
        reciteOn = !!(reciteSlot && reciteSlot.enabled)
      }
      var wmStamp = treeStamp()
      useEffect(function () {
        if (!reciteOn || !wmStamp || tree.phase !== 'ok' || !sessionId) return undefined
        if (readWm() === wmStamp) return undefined
        // 短延迟去抖:记录员落盘常伴随连续几次小改
        var t = setTimeout(function () {
          pushDigest(true).then(function (sent) { if (sent) writeWm(wmStamp) })
        }, 1200)
        return function () { clearTimeout(t) }
      }, [reciteOn, wmStamp, tree.phase, sessionId])

      var collapsedState = useState({})
      var collapsed = collapsedState[0]
      var setCollapsed = collapsedState[1]
      var bannerState = useState(null)
      var banner = bannerState[0]
      var setBanner = bannerState[1]
      var confirmState = useState(null)
      var confirmId = confirmState[0]
      var setConfirmId = confirmState[1]
      var busyState = useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]
      var bindSelState = useState('')
      var bindSel = bindSelState[0]
      var setBindSel = bindSelState[1]
      var wakeBusyState = useState(false)
      var wakeBusy = wakeBusyState[0]
      var setWakeBusy = wakeBusyState[1]
      var spawnBusyState = useState(false)
      var spawnBusy = spawnBusyState[0]
      var setSpawnBusy = spawnBusyState[1]

      function flash(kind, text) {
        var at = Date.now()
        setBanner({ kind: kind, text: text, at: at })
        setTimeout(function () {
          setBanner(function (b) { return (b && b.at === at) ? null : b })
        }, 6000)
      }

      /** Membership ops ride dir+session; node ops ride the resolved file path. Returns the RPC promise. */
      function runOp(payload, doneText) {
        if (!sessionId) { flash('error', '没有会话上下文'); return Promise.resolve(null) }
        var cmd = commandRemote()
        if (!cmd || typeof cmd.execute !== 'function') {
          flash('error', '命令通道不可用（需要重启 DSH 载入新版）')
          return Promise.resolve(null)
        }
        setBusy(true)
        return cmd.execute(sessionId, '/tree ' + JSON.stringify(payload), []).then(function (r) {
          setBusy(false)
          setConfirmId(null)
          var res = unwrap(r)
          if (res.kind === 'error') flash('error', res.text || '命令失败')
          else flash('ok', res.text || doneText)
          return res
        }).catch(function (e) {
          setBusy(false)
          setConfirmId(null)
          flash('error', String((e && e.message) || e))
          return null
        })
      }

      function memOp(op, extra) {
        var payload = { op: op, dir: dirAbs, session: sessionId }
        for (var k in (extra || {})) payload[k] = extra[k]
        return runOp(payload, '')
      }

      function onFold(id) {
        setCollapsed(function (c) {
          var next = {}
          for (var k in c) next[k] = c[k]
          if (next[id]) delete next[id]
          else next[id] = true
          return next
        })
      }

      function onStatus(n) {
        runOp({
          op: 'status',
          id: n.id,
          status: n.status === 'done' ? 'open' : 'done',
          path: tree.absPath,
        }, n.id + ' 状态已更新')
      }

      function onRemove(n, hasKids) {
        if (confirmId !== n.id) {
          setConfirmId(n.id)
          setTimeout(function () {
            setConfirmId(function (c) { return c === n.id ? null : c })
          }, 4000)
          return
        }
        runOp({ op: 'remove', id: n.id, path: tree.absPath },
          '已移除 ' + n.id + (hasKids ? '（含子节点）' : ''))
      }

      // ── recorder session: bind + wake (cold resume via session.prompt) ──
      function bindRecorder(recId) {
        if (!recId) { flash('error', '先在下拉里选一个会话'); return }
        if (mode === 'legacy') {
          // Legacy has no state.json yet: switch to managed mode (this session
          // keeps the shared tree), then write the binding once that landed.
          runOp({ op: 'initState', dir: dirAbs, session: sessionId }, '已切换为按会话管理')
            .then(function (res) {
              if (res && res.kind === 'success') memOp('bindRecorder', { recorder: recId })
            })
          return
        }
        memOp('bindRecorder', { recorder: recId })
      }

      function wakeRecorder(recId) {
        var svc = sessionRemote()
        if (!svc || typeof svc.prompt !== 'function') {
          flash('error', 'session.prompt 通道不可用（需要重启 DSH 载入新版）')
          return
        }
        var src = treeAbs || (dirAbs ? dirAbs + '/' + LEGACY_TREE : '')
        var tz = ''
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { /* keep empty */ }
        setWakeBusy(true)
        svc.prompt({
          requestId: randomId(),
          sessionId: recId,
          mode: 'queue',
          content: [{
            type: 'text',
            text: '继续维护讨论树：数据源 ' + src + '。本轮讨论在会话 ' + sessionId + '（用 cross_session_read 读它的最近消息；只巡检这一个会话，别的会话与别的树都不归你管）。巡检规则：有新定案就更新节点；讨论换到了新的工作内容、或原有设计已落地成实物，也算新节点，挂到对应父节点下；带 manual 的节点只读不动；加节点前先问「这条定了之后后面哪一步会不一样」。完成后只更新树文件，不要调用 cross_session_reply 回信——面板头部的「当前/悬挂/更新于」就是回报。',
          }],
          clientTimeZone: tz || undefined,
        }).then(function (r) {
          setWakeBusy(false)
          if (r && r.ok) flash('ok', '已发送唤醒，' + shortId(recId) + ' 将在几十秒内回报三行')
          else flash('error', (r && r.error && r.error.message) || '唤醒失败')
        }).catch(function (e) {
          setWakeBusy(false)
          flash('error', String((e && e.message) || e))
        })
      }

      /** Spawn a brand-new recorder session (task message + bind) for THIS tree. */
      function spawnRecorder() {
        var sessions = null
        try { sessions = CTX.get('sessions') } catch (e) { sessions = null }
        if (!sessions || typeof sessions.create !== 'function') {
          flash('error', 'sessions 服务不可用（缺少 create）')
          return
        }
        var svc = sessionRemote()
        if (!svc || typeof svc.prompt !== 'function') {
          flash('error', 'session.prompt 通道不可用（需要重启 DSH 载入新版）')
          return
        }
        setSpawnBusy(true)
        var src = treeAbs || (dirAbs ? dirAbs + '/' + LEGACY_TREE : '')
        var createReq = currentWsId ? { workspaceId: currentWsId } : (cwd ? { cwd: cwd } : null)
        if (!createReq) {
          setSpawnBusy(false)
          flash('error', '定位不到本会话的工作区，无法派生')
          return
        }
        var tz = ''
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { /* keep empty */ }
        // 命名:按现有记录员数编「辅·讨论树记录员·N」,第一个不带编号
        var recsNow = (ws.state && ws.state.recorders && typeof ws.state.recorders === 'object') ? ws.state.recorders : null
        var recCount = 0
        if (recsNow) for (var rk in recsNow) { if (Object.prototype.hasOwnProperty.call(recsNow, rk)) recCount++ }
        var recTitle = recCount === 0 ? '辅·讨论树记录员' : '辅·讨论树记录员·' + (recCount + 1)
        sessions.create(createReq).then(function (newId) {
          // 官方改名通道;失败不阻塞派生(顶多落到自动标题)
          var named = (svc && typeof svc.rename === 'function')
            ? svc.rename({ sessionId: newId, title: recTitle }).catch(function () { /* keep going */ })
            : null
          return (named || Promise.resolve()).then(function () {
            return svc.prompt({
              requestId: randomId(),
              sessionId: newId,
              mode: 'queue',
              content: [{
                type: 'text',
                text: '你是「' + recTitle + '」，维护数据源 ' + src + '。绑定你的会话每次「唤醒」会投来巡检指令（内含目标会话 id），届时用 cross_session_read 读它的最近消息并按规则更新树文件：有新定案就更新节点；讨论换到新的工作内容、或原有设计已落地成实物，也算新节点，挂到对应父节点下；带 manual 的节点只读不动；加节点前先问「这条定了之后后面哪一步会不一样」。完成后只更新树文件，不要调用 cross_session_reply 回信——树面板头部的「当前/悬挂/更新于」就是回报。现在先读一遍数据源熟悉主线，然后等待第一次唤醒，不必回话。',
              }],
              clientTimeZone: tz || undefined,
            }).then(function () {
              return memOp('bindRecorder', { recorder: newId })
            }).then(function (res) {
              if (res && res.kind === 'error') throw new Error(res.message || '绑定失败')
              return newId
            })
          })
        }).then(function (newId) {
          setSpawnBusy(false)
          flash('ok', '已派生「' + recTitle + '」（' + shortId(newId) + '）并绑定到当前树')
        }).catch(function (e) {
          setSpawnBusy(false)
          flash('error', '派生失败：' + String((e && e.message) || e))
        })
      }

      function renderRecorder() {
        var rec = null
        if (ws.state) {
          var recs = ws.state.recorders
          var tf = (entry && entry.treeFile) ? entry.treeFile : 'tree.json'
          if (recs && typeof recs === 'object' && recs[tf] && recs[tf].sessionId) rec = recs[tf]
          else if (ws.state.recorder && (tf === 'tree.json' || !recs)) rec = ws.state.recorder
        }
        var archived = {}
        for (var a = 0; a < archivedIds.length; a++) archived[archivedIds[a]] = true
        var rows = []
        for (var i = 0; i < ids.length; i++) {
          var sum = byId[ids[i]]
          if (!sum || ids[i] === sessionId) continue
          if (archived[ids[i]]) continue // 已归档会话不进绑定下拉：宿主拒绝它们跑模型
          if (sum.origin === 'subagent') continue // 派生的任务会话，不是可对话的记录员候选
          if (sum.blank) continue // 空会话还没有内容
          var sumCwd = sum.cwd ? sum.cwd.replace(/[\\/]+$/, '') : ''
          var myCwd = cwd ? cwd.replace(/[\\/]+$/, '') : ''
          if (!sumCwd || !myCwd || sumCwd !== myCwd) continue
          rows.push({
            id: ids[i],
            title: sum.title || sum.displayTitle || ids[i],
            fork: !!sum.parentSessionId,
            running: sum.running,
            at: sum.updatedAt || 0,
          })
        }
        rows.sort(function (a, b) {
          if (a.running !== b.running) return a.running ? -1 : 1
          return b.at - a.at
        })
        var kids = [h('span', { className: 'dt-reclabel', key: 'label' }, '记录会话')]
        if (rec && rec.sessionId) {
          var info = byId[rec.sessionId]
          var whoName = info ? (info.title || info.displayTitle || '') : ''
          kids.push(h('span', { key: 'who' },
            (whoName ? whoName + ' · ' : '') + shortId(rec.sessionId) +
            (info ? (info.running ? '（运行中）' : '（空闲）') : '（不在列表，可能已删除）')))
          if (archived[rec.sessionId]) {
            kids.push(h('span', { key: 'arch', className: 'dt-warn', style: { marginTop: 0 } },
              '已归档：唤醒无法运行（平台拒绝已归档会话执行），请解绑后另选会话'))
          }
          kids.push(h('button', {
            key: 'wake', className: 'dt-btn dt-primary', disabled: wakeBusy || busy,
            title: '向记录会话投递续维指令；冷会话会自动复活',
            onClick: function () { wakeRecorder(rec.sessionId) },
          }, wakeBusy ? '发送中…' : '唤醒'))
          kids.push(h('button', {
            key: 'unbind', className: 'dt-btn', disabled: busy,
            onClick: function () { memOp('unbindRecorder') },
          }, '解绑'))
          kids.push(h('button', {
            key: 'respawn', className: 'dt-btn', disabled: busy || spawnBusy,
            title: '再派生一个新会话并把当前树的绑定移交给它；旧的辅助会话不会被删除，确认没用了再删',
            onClick: spawnRecorder,
          }, spawnBusy ? '派生中…' : '另派新的'))
        } else {
          var options = [h('option', { key: 'none', value: '' }, '选择会话…')]
          for (var j = 0; j < rows.length && j < 40; j++) {
            var label = rows[j].title + (rows[j].running ? '（运行中）' : '') + (rows[j].fork ? '〔fork〕' : '')
            options.push(h('option', { key: rows[j].id, value: rows[j].id }, label))
          }
          kids.push(h('select', {
            key: 'sel', className: 'dt-sel', value: bindSel,
            onChange: function (e) { setBindSel(e.target.value) },
          }, options))
          kids.push(h('button', {
            key: 'bind', className: 'dt-btn dt-primary', disabled: busy || !bindSel,
            title: mode === 'legacy' ? '绑定会同时开启按会话管理（本会话沿用共享树）' : '记录要绑定的辅助会话',
            onClick: function () { bindRecorder(bindSel) },
          }, '绑定'))
          kids.push(h('button', {
            key: 'spawn', className: 'dt-btn', disabled: busy || spawnBusy,
            title: '新建一个会话、写入记录员任务书并绑定为当前树的记录员（旧记录员被删除或归档后用它补位）',
            onClick: spawnRecorder,
          }, spawnBusy ? '派生中…' : '派生新记录员'))
        }
        return h('div', { className: 'dt-rec' }, h('div', { className: 'dt-recrow' }, kids))
      }

      var bannerEl = banner ? h('div', { key: 'banner', className: 'dt-banner dt-' + banner.kind }, banner.text) : null

      if (mode === 'onboard') {
        return h('div', { className: 'dt-root' },
          bannerEl,
          h('div', { className: 'dt-head' },
            h('div', { className: 'dt-path' }, '本会话尚未开启讨论树'),
            h('div', { className: 'dt-meta' }, '按会话独立管理；从旧会话 fork 出的新会话会自动接着父会话的树')),
          h('div', { className: 'dt-onboard' },
            h('button', {
              className: 'dt-btn dt-primary dt-big', disabled: busy,
              onClick: function () { forkMark(); memOp('init') },
            }, '开启空白讨论树'),
            parentSessionId && forkProbe === 'found'
              ? h('button', {
                className: 'dt-btn dt-primary dt-big', disabled: busy,
                title: '和 ' + parentSessionId + ' 看同一份树，记录员更新时两边一起变',
                onClick: function () { forkMark(); memOp('inherit', { from: parentSessionId, as: 'share' }) },
              }, '接着父会话用（共用）')
              : null,
            parentSessionId && forkProbe === 'found'
              ? h('button', {
                className: 'dt-btn dt-big', disabled: busy,
                title: '把 ' + parentSessionId + ' 的树复制一份给本会话，之后各长各的',
                onClick: function () { forkMark(); memOp('inherit', { from: parentSessionId, as: 'copy' }) },
              }, '复制一份独立用')
              : null,
            h('button', {
              className: 'dt-btn dt-big', disabled: busy,
              title: '多个会话共用工作区的那份 tree.json',
              onClick: function () { forkMark(); memOp('adoptShared') },
            }, '使用工作区共享树'),
            h('div', { className: 'dt-hint' },
              forkProbe === 'probing' ? '正在检查 fork 来源…'
                : (parentSessionId && forkProbe === 'missing')
                  ? 'fork 来源 ' + parentSessionId + ' 没有独立讨论树'
                  : '')),
          h('div', { className: 'dt-foot' }, 'tree ' + VERSION + ' · ' + DIR_REL + '/ · 每 ' + (POLL_MS / 1000) + ' 秒刷新'))
      }

      if (mode === 'closed') {
        return h('div', { className: 'dt-root' },
          bannerEl,
          h('div', { className: 'dt-empty', style: { padding: '8px 0' } }, '本会话的讨论树已关闭'),
          h('div', { className: 'dt-onboard' },
            h('button', {
              className: 'dt-btn dt-primary dt-big', disabled: busy,
              onClick: function () { memOp('enable') },
            }, '重新开启')),
          h('div', { className: 'dt-foot' }, 'tree ' + VERSION + ' · ' + DIR_REL + '/ · 每 ' + (POLL_MS / 1000) + ' 秒刷新'))
      }

      // legacy | on
      var shared = mode === 'legacy' || (entry && entry.treeFile === LEGACY_TREE)
      var sourceBadge = mode === 'legacy'
        ? '工作区共享模式'
        : (entry && entry.source === 'migrated' ? '迁移自 ' + (entry.migratedFrom || '?')
          : (shared ? '共享树' : '本会话专属'))
      var treeAbs = cwd ? joinPath(cwd, DIR_REL + '/' + treeFile) : null

      if (tree.phase === 'ok') {
        var nodes = tree.data.nodes || []
        var ix = indexPath(nodes)
        var current = tree.data.current
        var paths = pathOf(ix.byId, current)
        var hang = nodes.filter(function (n) {
          return n.status !== 'done' && n.parent !== null && n.parent !== undefined
        })
        var ui = {
          kids: ix.kids,
          collapsed: collapsed,
          confirmId: confirmId,
          busy: busy,
          onFold: onFold,
          onStatus: onStatus,
          onRemove: onRemove,
        }
        var retargetHint = (!shared && cwd)
          ? '记录员换源：以后只维护 ' + treeAbs
          : null
        return h('div', { className: 'dt-root' },
          bannerEl,
          h('div', { className: 'dt-top' },
            h('span', { className: 'dt-badge', title: treeAbs || '' }, sourceBadge),
            h('span', { className: 'dt-spacer' }),
            mode === 'legacy'
              ? h('button', {
                key: 'manage', className: 'dt-btn dt-primary', disabled: busy,
                title: '创建 state.json，之后每个会话可独立开启/关闭/迁移',
                onClick: function () { memOp('initState') },
              }, '按会话管理')
              : h('button', {
                key: 'close', className: 'dt-btn dt-danger', disabled: busy,
                title: '本会话停用讨论树（文件保留，可重开）',
                onClick: function () { memOp('disable') },
              }, '关闭'),
            mode === 'on'
              ? (treeFile === 'sessions/' + sessionId + '.json'
                ? (entry && (entry.inheritedFrom || entry.detachedFrom)
                  ? h('button', {
                    key: 'shareback', className: 'dt-btn', disabled: busy,
                    title: '改回和父会话共用同一份树；自己的副本留在磁盘上不删',
                    onClick: function () { memOp('shareBack') },
                  }, '改回共用')
                  : null)
                : h('button', {
                  key: 'detach', className: 'dt-btn', disabled: busy,
                  title: '把当前这份树复制成只属于本会话的一份，之后各长各的',
                  onClick: function () { memOp('detach') },
                }, '另存独立'))
              : null),
          h('div', { className: 'dt-head' },
            h('div', { className: 'dt-path' }, '当前 ' + (paths || '—')),
            h('div', { className: 'dt-warn' },
              '悬挂 ' + (hang.length ? hang.map(function (n) { return n.id }).join('、') : '无')),
            h('div', { className: 'dt-meta' },
              (tree.data.title || '讨论主线') + ' · ' + nodes.length + ' 节点 · 更新于 ' + fmtTime(tree.at))),
          walk(ix.kids, ix.kids['__root__'] || [], 0, current, [], ui),
          h('div', { className: 'dt-rec' },
            h('div', { className: 'dt-recrow' },
              h('span', { className: 'dt-reclabel' }, '主线同步'),
              h('button', {
                className: 'dt-btn dt-primary', disabled: alignBusy,
                title: '把「当前位置+悬挂+最近节点」组成摘要投递给本会话;下一轮开工前模型就能看到',
                onClick: alignNow,
              }, alignBusy ? '投递中…' : '对齐主线'),
              mode === 'on'
                ? h('button', {
                  className: 'dt-btn', disabled: busy,
                  title: '复述(Manus 式):记录员每次更新树,自动把最新主线摘要投给当前开着面板的会话。开关按树记住。',
                  onClick: toggleRecite,
                }, reciteOn ? '复述:开' : '复述:关')
                : null)),
          renderRecorder(),
          retargetHint ? h('div', { className: 'dt-hint' }, retargetHint) : null,
          h('div', { className: 'dt-foot' },
            'tree ' + VERSION + ' · ' + DIR_REL + '/' + treeFile + ' · 每 ' + (POLL_MS / 1000) + ' 秒刷新 · 悬停行可 移除/标答/折叠'))
      }

      var views = [bannerEl]
      if (tree.phase === 'missing' && mode === 'on') {
        views.push(h('div', { className: 'dt-empty' }, '本会话的树文件还没创建（' + treeFile + '）'))
        views.push(h('div', { className: 'dt-onboard' },
          h('button', {
            className: 'dt-btn dt-primary dt-big', disabled: busy,
            onClick: function () { memOp('init') },
          }, '创建空白讨论树')))
      } else if (tree.phase === 'error') {
        var notFound = /not[-_]?found|ENOENT|no such file/i.test((tree.code || '') + ' ' + (tree.error || ''))
        views.push(h('div', { className: 'dt-err' },
          (notFound ? '本工作区还没有 ' + DIR_REL + '/' + LEGACY_TREE : '读不到 ' + DIR_REL + '/' + (treeFile || LEGACY_TREE) + (tree.code ? '（' + tree.code + '）' : '')),
          h('small', null, tree.error || '')))
        views.push(h('div', { className: 'dt-foot' }, '讨论开场后由记录员会话创建；每 ' + (POLL_MS / 1000) + ' 秒重试'))
      } else if (tree.phase === 'badjson') {
        views.push(h('div', { className: 'dt-err' }, '树文件不是合法 JSON', h('small', null, tree.error || '')))
      } else if (tree.phase === 'empty') {
        views.push(h('div', { className: 'dt-empty' }, '没有会话上下文'))
      } else {
        views.push(h('div', { className: 'dt-empty' }, '载入中…'))
      }
      if (ws.error) views.push(h('div', { className: 'dt-warn' }, ws.error))
      return h('div', { className: 'dt-root' }, views)
    }

    function apply(ctx) {
      ensureStyle()
      // Never touch ctx.remote.<namespace> here: namespace faces resolve through
      // the context service table and throw while still mounting, which fails
      // the whole fiber. They are read lazily through workspaceFiles() /
      // commandRemote() instead.
      CTX = ctx

      ctx.effect(function () {
        return ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          title: function () { return '主线' },
          guide: [{
            id: 'mainline',
            order: 20,
            title: function () { return '主线话题树' },
            description: function () { return '查看讨论主线;对齐主线/自动复述、绑定并唤醒记录员' },
            icon: function () { return h('span', null, '🌳') },
          }],
        })
      }, 'discussion-tree.tab-type')

      // The seat is declared asynchronously by ui-sidebar-right (inside its own
      // slots.inject); a bare register() into an undeclared seat throws at
      // activation and fails web boot. Wait for the declaration like every
      // shipped tab type does.
      ctx.effect(function () {
        return ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, TreeBody)
        })
      }, 'discussion-tree.body')

      ctx.effect(function () {
        var timer = setTimeout(function () {
          try {
            if (ctx.sidebarRight && typeof ctx.sidebarRight.openTab === 'function') {
              ctx.sidebarRight.openTab(KIND)
            }
          } catch (e) { /* user can open it from the strip */ }
        }, 1500)
        return function () { clearTimeout(timer) }
      }, 'discussion-tree.auto-open')
    }

    exports.apply = apply
    exports.inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles', 'remote.commands', 'remote.session', 'sessions']
    return module.exports
  }
})
