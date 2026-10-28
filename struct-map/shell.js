    // ---------- React shell: the tab body ----------
    const React = require('react')
    const h = React.createElement
    const TAB_ID = 'struct-map'
    const KIND = 'struct-map'
    const ZH = typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh')
    const T = (zh, en) => (ZH ? zh : en)

    const LIGHT = { bg: '#ffffff', box: '#f6f7f9', boxEdge: '#dde1e7', ink: '#1c2128', sub: '#5b6672', note: '#6b7683' }
    const DARK = { bg: '#1b1e24', box: '#232732', boxEdge: '#39414f', ink: '#e7eaf0', sub: '#9aa4b2', note: '#8d97a5' }

    const S = {
      page: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
      head: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      title: { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
      select: { flex: 1, minWidth: 0, fontSize: 11, padding: '3px 6px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
      icon: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', borderRadius: 5, width: 24, height: 22, cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 },
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 12px 24px' },
      empty: { padding: 30, textAlign: 'center', fontSize: 11, lineHeight: 1.9, color: 'var(--dsw-alias-label-tertiary)' },
      bad: { margin: '0 0 10px', padding: '6px 9px', borderRadius: 6, fontSize: 10, lineHeight: 1.6, color: 'var(--dsw-alias-danger-primary, #c2410c)', border: '1px solid var(--dsw-alias-danger-primary, #c2410c)', background: 'transparent', wordBreak: 'break-all' },
      foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 12px', borderTop: '1px solid var(--dsw-alias-border-l1)', fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' },
    }

    const darkNow = () => {
      try {
        const el = document.documentElement
        const t = el.getAttribute('data-theme') || el.getAttribute('data-color-scheme') || el.getAttribute('data-ds-theme') || ''
        if (t) return /dark/i.test(t)
        if (el.classList && el.classList.contains('dark')) return true
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      } catch (e) { return false }
    }

    function useDark() {
      const [dark, setDark] = React.useState(darkNow)
      React.useEffect(() => {
        const sync = () => setDark(darkNow())
        const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null
        if (mo) mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-color-scheme', 'data-ds-theme', 'class'] })
        const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        if (mq && mq.addEventListener) mq.addEventListener('change', sync)
        return () => { if (mo) mo.disconnect(); if (mq && mq.removeEventListener) mq.removeEventListener('change', sync) }
      }, [])
      return dark
    }

    function Diagram({ data, avail, dark, sel, onPick }) {
      const built = React.useMemo(() => {
        try {
          const lay = layout(data, Math.max(280, Math.round(avail) - 10))
          return { lay, report: check(lay) }
        } catch (e) {
          return { error: String((e && e.message) || e) }
        }
      }, [data, avail])
      if (built.error) return h('div', { style: S.empty }, built.error)
      const html = React.useMemo(() => svg(built.lay, dark ? DARK : LIGHT, { hi: sel }), [built, dark, sel])
      const bad = built.report.violations
      const onPickNode = (ev) => {
        let el = ev.target
        while (el && el !== ev.currentTarget) {
          if (el.getAttribute && el.getAttribute('data-n')) {
            const id = el.getAttribute('data-n')
            onPick(id === sel ? '' : id)
            return
          }
          el = el.parentNode
        }
        onPick('')
      }
      return h('div', { style: { width: '100%' }, onClick: onPickNode },
        bad.length
          ? h('div', { style: S.bad }, (ZH ? '这张图有 ' : 'readability problems: ') + bad.length + (ZH ? ' 处问题：' : ' — ') + bad.slice(0, 3).join(' ｜ '))
          : null,
        h('div', { dangerouslySetInnerHTML: { __html: html } }),
      )
    }

    function StructBody() {
      const [files, setFiles] = React.useState([])
      const [file, setFile] = React.useState('')
      const [data, setData] = React.useState(null)
      const [mtime, setMtime] = React.useState(0)
      const [error, setError] = React.useState('')
      const [avail, setAvail] = React.useState(720)
      const [sel, setSel] = React.useState('')
      const boxRef = React.useRef(null)
      const dark = useDark()

      React.useEffect(() => {
        const el = boxRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(() => setAvail(el.clientWidth || 720))
        ro.observe(el)
        setAvail(el.clientWidth || 720)
        return () => ro.disconnect()
      }, [])

      const list = React.useCallback(() => {
        fetch('/struct-map-list', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((d) => {
            const next = (d && d.files) || []
            setFiles(next)
            setFile((cur) => (cur && next.some((f) => f.file === cur) ? cur : next[0] ? next[0].file : ''))
          })
          .catch((e) => setError(String((e && e.message) || e)))
      }, [])

      const load = React.useCallback((target) => {
        if (!target) return
        fetch('/struct-map-data?file=' + encodeURIComponent(target), { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((d) => {
            if (!d || !d.ok) {
              setError((d && d.error) || 'read failed')
              setData(null)
              return
            }
            setError('')
            setData(d.data)
            setMtime(d.mtime || 0)
          })
          .catch((e) => setError(String((e && e.message) || e)))
      }, [])

      React.useEffect(() => {
        list()
        const t = setInterval(list, 4000)
        return () => clearInterval(t)
      }, [list])

      React.useEffect(() => { setSel('') }, [file])

      React.useEffect(() => {
        if (!file) return
        load(file)
        const t = setInterval(() => load(file), 2000)
        return () => clearInterval(t)
      }, [file, load])

      return h('div', { style: S.page },
        h('div', { style: S.head },
          h('span', { style: S.title }, T('结构图', 'Structure')),
          files.length
            ? h('select', { style: S.select, value: file, onChange: (e) => setFile(e.target.value) }, files.map((f) => h('option', { key: f.file, value: f.file }, f.name)))
            : h('span', { style: { ...S.title, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)' } }, T('未找到 *.struct.json', 'no *.struct.json')),
          h('button', { style: S.icon, title: T('刷新', 'Refresh'), onClick: () => { list(); load(file) } }, '⟳'),
        ),
        h('div', { style: S.body, ref: boxRef },
          error ? h('div', { style: S.empty }, error)
            : data ? h(Diagram, { data, avail, dark, sel, onPick: setSel })
              : h('div', { style: S.empty }, T('工作区里放一份 *.struct.json，这里会自动读到它的变化。', 'Drop a *.struct.json into the workspace; this view follows it.')),
        ),
        h('div', { style: S.foot },
          h('span', null, (data && data.title) || ''),
          h('span', null, mtime ? new Date(mtime).toLocaleTimeString() : '—')),
      )
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          title: () => T('结构图', 'Structure'),
          guide: [{
            id: TAB_ID,
            order: 30,
            title: () => T('结构图', 'Structure map'),
            description: () => T('把工作区里的 *.struct.json 画成图：分组、方块、箭头。', 'Draw every *.struct.json as grouped boxes and arrows.'),
            icon: () => h('span', null, '◧'),
          }],
        }), 'struct-map.tab-type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, StructBody),
        ), 'struct-map.body')
      },
    }
