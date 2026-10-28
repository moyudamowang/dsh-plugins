const fs = require('fs')
let captured = null
global.window = { __ModuleLoader__: { load: (def) => { captured = def } }, matchMedia: () => null }
global.navigator = { language: 'zh-CN' }
global.document = { documentElement: { getAttribute: () => null, classList: { contains: () => false } } }
const ReactStub = {
  createElement: () => null,
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useMemo: (f) => f(),
  useCallback: (f) => f,
  useRef: () => ({ current: null }),
}
const src = fs.readFileSync('client.js', 'utf8')
eval(src)
if (!captured) throw new Error('module never registered')
const api = captured.factory((name) => { if (name === 'react') return ReactStub; throw new Error('unexpected require ' + name) })
if (!api || !api.inject || !api.apply) throw new Error('bad api shape')
const registered = []
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  sidebarRightTabs: { register: (d) => { registered.push(['tab', d.id]); return () => {} } },
  slots: { inject: () => {}, register: (d) => { registered.push(['slot', d.key]); return () => {} } },
}
api.apply(ctx)
console.log('inject =', api.inject.join(','))
console.log('registered =', JSON.stringify(registered))
console.log('SMOKE OK')
