/** Client half: delegated hover over inline code, self-drawn card, click opens VSCode. */
window.__ModuleLoader__.load({
  id: '@local/hover-index',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ZH =
      typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh')

    const KIND = ZH
      ? {
          func: '函数', method: '方法', var: '变量', field: '字段', property: '属性',
          class: '类', interface: '接口', struct: '结构体', enum: '枚举', record: '记录',
          signal: '信号', const: '常量', namespace: '命名空间', import: '导入', file: '文件',
          param: '参数',
        }
      : {
          func: 'function', method: 'method', var: 'variable', field: 'field', property: 'property',
          class: 'class', interface: 'interface', struct: 'struct', enum: 'enum', record: 'record',
          signal: 'signal', const: 'constant', namespace: 'namespace', import: 'import', file: 'file',
          param: 'parameter',
        }

    const NAME_RE = /^[A-Za-z_$][\w.$]{1,80}$/
    const FILE_RE =
      /^[A-Za-z_][\w.@\/-]*\.(?:cs|gd|py|ts|tsx|js|json|md|tscn|cfg|txt|yml|yaml)(?::\d+)?$/i

    function kindLabel(kind) {
      return KIND[kind] || (ZH ? '符号' : 'symbol')
    }

    function vscodeUrl(item) {
      const p = String(item.abs || '').replace(/\\/g, '/')
      return 'vscode://file/' + encodeURI(p) + ':' + item.line
    }

    const base = {
      card: {
        position: 'fixed',
        zIndex: 2147483000,
        width: 360,
        maxHeight: 380,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-overlay)',
        color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
        padding: '6px 0',
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: 'inherit',
      },
      head: { padding: '4px 12px 6px', display: 'flex', alignItems: 'center', gap: 6 },
      name: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      kind: {
        flex: '0 0 auto',
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      row: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        minHeight: 28,
        padding: '4px 10px',
        margin: '0 6px',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
      },
      list: {
        overflowY: 'auto',
        maxHeight: 214,
        padding: '2px 0',
        display: 'flex',
        flexDirection: 'column',
      },
      path: {
        flex: '1 1 auto',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-secondary)',
      },
      line: { flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      doc: {
        padding: '0 12px 6px',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11.5,
        lineHeight: 1.45,
        maxHeight: 76,
        overflow: 'hidden',
      },
      decl: {
        padding: '0 12px 6px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      foot: { padding: '6px 12px 2px', fontSize: 10, color: 'var(--dsw-alias-label-secondary)' },
    }

    function HoverLayer() {
      const [card, setCard] = React.useState(null)
      const st = React.useRef({ timer: null, hideTimer: null, seq: 0, current: null })
      const cardRef = React.useRef(null)

      React.useEffect(() => {
        const s = st.current

        function clearTimer() {
          if (s.timer) {
            clearTimeout(s.timer)
            s.timer = null
          }
        }
        function clearHide() {
          if (s.hideTimer) {
            clearTimeout(s.hideTimer)
            s.hideTimer = null
          }
        }
        function inside(rect, x, y) {
          return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        }

        /** Word under the cursor inside a code block, with that word's own rect. */
        function wordAtPoint(x, y) {
          let range = null
          try {
            if (document.caretRangeFromPoint) {
              range = document.caretRangeFromPoint(x, y)
            } else if (document.caretPositionFromPoint) {
              const pos = document.caretPositionFromPoint(x, y)
              if (pos) {
                range = document.createRange()
                range.setStart(pos.offsetNode, pos.offset)
                range.collapse(true)
              }
            }
          } catch {
            return null
          }
          if (!range || !range.startContainer || range.startContainer.nodeType !== 3) return null
          const node = range.startContainer
          const text = node.textContent || ''
          let start = range.startOffset
          let end = range.startOffset
          while (start > 0 && /[\w.$]/.test(text[start - 1])) start--
          while (end < text.length && /[\w.$]/.test(text[end])) end++
          const word = text.slice(start, end)
          if (!word) return null
          try {
            const wordRange = document.createRange()
            wordRange.setStart(node, start)
            wordRange.setEnd(node, end)
            return { word, rect: wordRange.getBoundingClientRect() }
          } catch {
            return null
          }
        }

        function onOver(e) {
          if (cardRef.current && cardRef.current.contains(e.target)) return
          clearHide()
          let name = ''
          let rect = null
          const inline = e.target && e.target.closest ? e.target.closest('code') : null
          if (inline && inline.textContent) {
            const raw = inline.textContent.trim()
            name = raw.replace(/\(.*$/, '').replace(/<.*$/, '').trim()
            rect = inline.getBoundingClientRect()
          } else {
            const block = e.target && e.target.closest ? e.target.closest('pre') : null
            if (!block) return
            const found = wordAtPoint(e.clientX, e.clientY)
            if (!found) return
            name = found.word
            rect = found.rect
          }
          if (!NAME_RE.test(name) && !FILE_RE.test(name)) return
          if (s.current === name) return
          s.current = name
          clearTimer()
          const position = { left: rect.left, top: rect.top, bottom: rect.bottom }
          s.rect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
          s.timer = setTimeout(() => {
            const seq = ++s.seq
            fetch('/hover-index?name=' + encodeURIComponent(name), { credentials: 'same-origin' })
              .then((res) => res.json())
              .then((data) => {
                if (seq !== s.seq) return
                if (!data || !data.ok || !Array.isArray(data.items) || data.items.length === 0) {
                  setCard(null)
                  return
                }
                setCard({ name, items: data.items, position, scanned: !!data.scanned, tookMs: data.tookMs })
              })
              .catch(() => {
                if (seq === s.seq) setCard(null)
              })
          }, 400)
        }

        function onOut(e) {
          const t = e.target
          if (!t || !t.closest) return
          if (!t.closest('code, pre')) return
          clearTimer()
          s.current = null
        }

        // While a card is open, hide only once the pointer is away from both the
        // code word and the card itself — moving towards the card must not dismiss it.
        function onMove(e) {
          if (!cardRef.current || !s.rect) return
          const cardRect = cardRef.current.getBoundingClientRect()
          if (inside(cardRect, e.clientX, e.clientY) || inside(s.rect, e.clientX, e.clientY)) {
            clearHide()
            return
          }
          if (!s.hideTimer) s.hideTimer = setTimeout(() => setCard(null), 320)
        }

        function onKey(e) {
          if (e.key === 'Escape') {
            clearTimer()
            setCard(null)
          }
        }
        function onScroll(e) {
          if (e && e.target && cardRef.current && cardRef.current.contains(e.target)) return
          if (cardRef.current) {
            clearTimer()
            setCard(null)
          }
        }

        document.addEventListener('mouseover', onOver, true)
        document.addEventListener('mouseout', onOut, true)
        document.addEventListener('mousemove', onMove, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('mouseover', onOver, true)
          document.removeEventListener('mouseout', onOut, true)
          document.removeEventListener('mousemove', onMove, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('scroll', onScroll, true)
          clearTimer()
          clearHide()
        }
      }, [])

      if (!card) return null

      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800
      const left = Math.max(8, Math.min(card.position.left, vw - 368))
      const placeAbove = vh - card.position.bottom < 320
      const style = placeAbove
        ? { ...base.card, left, bottom: vh - card.position.top + 8 }
        : { ...base.card, left, top: card.position.bottom + 8 }

      const primary = card.items[0]
      const multiRoot = new Set(card.items.map((item) => item.rootLabel)).size > 1
      const inheritText =
        primary.inherits && primary.inherits.length
          ? ' · ' +
            (ZH ? '继承 ' : 'extends ') +
            primary.inherits.map((parent) => parent.name).join(', ')
          : ''
      const declText = primary.decl || primary.qualified
        ? (primary.decl || primary.qualified) + inheritText
        : ''

      return h(
        'div',
        {
          ref: cardRef,
          'data-hover-card': '1',
          style,
          onMouseEnter: () => {
            if (st.current.hideTimer) {
              clearTimeout(st.current.hideTimer)
              st.current.hideTimer = null
            }
          },
          onMouseLeave: () => {
            st.current.hideTimer = setTimeout(() => setCard(null), 320)
          },
        },
        h(
          'style',
          null,
          '.dshhi-row:hover{background:var(--dsw-alias-bg-layer-2);}' +
            '.dshhi-scroll{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;}' +
            '.dshhi-scroll::-webkit-scrollbar{width:8px;}' +
            '.dshhi-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:4px;}' +
            '.dshhi-scroll::-webkit-scrollbar-track{background:transparent;}',
        ),
        h(
          'div',
          { style: base.head },
          h('span', { style: base.name }, card.name),
          h('span', { style: base.kind }, kindLabel(card.items[0].kind)),
          card.items.length > 1
            ? h('span', { style: base.kind }, String(card.items.length) + (ZH ? ' 条' : ''))
            : null,
        ),
        primary.doc ? h('div', { style: base.doc }, primary.doc) : null,
        declText ? h('div', { style: base.decl }, declText) : null,
        h(
          'div',
          { className: 'dshhi-scroll', style: base.list },
          card.items.map((item, i) =>
            h(
              'a',
              {
                key: i,
                className: 'dshhi-row',
                href: vscodeUrl(item),
                style: base.row,
                title: item.abs + ':' + item.line + (item.doc ? '\n' + item.doc : ''),
                onClick: (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const fallback = () => {
                    window.location.href = vscodeUrl(item)
                  }
                  fetch(
                    '/hover-index-open?file=' +
                      encodeURIComponent(item.file) +
                      '&line=' +
                      item.line +
                      '&root=' +
                      encodeURIComponent(item.root || ''),
                    { credentials: 'same-origin' },
                  )
                    .then((r) => r.json())
                    .then((d) => {
                      if (!d || !d.ok) fallback()
                    })
                    .catch(fallback)
                },
              },
              multiRoot ? h('span', { style: base.kind }, item.rootLabel) : null,
              h('span', { style: base.path }, String(item.file).split('/').pop()),
              h('span', { style: base.line }, ':' + item.line),
              item.callers && item.callers.count
                ? h('span', { style: base.kind }, (ZH ? '被调 ' : 'calls ') + item.callers.count)
                : null,
            ),
          ),
        ),
        h(
          'div',
          { style: base.foot },
          (ZH ? '点击文件名用 VSCode 打开' : 'Click a file to open in VSCode') +
            (card.scanned ? (ZH ? ' · 现场搜索' : ' · scanned') : '') +
            (typeof card.tookMs === 'number' ? ' · ' + card.tookMs + 'ms' : ''),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'hover-index', order: 90 }, HoverLayer),
        )
      },
    }
  },
})
