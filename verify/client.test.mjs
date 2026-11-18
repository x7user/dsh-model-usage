/**
 * Offline harness for `client.js`.
 *
 * It runs the exact bundle the browser receives inside a fake `window`, a
 * minimal React hook runtime and a scripted `fetch`, then inspects the produced
 * element tree. That proves the bundle's own logic — provider routing, the
 * three window adapters, the collapsed figures and the expanded rows — without
 * a browser. It cannot prove what the page paints.
 *
 * Run with: node --test verify/client.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// The entry re-reads every minute. A real interval would keep the test process
// alive forever, so it is replaced with an inert handle; polling is asserted by
// the `fetch` script instead.
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

/** The document body the bundle portals its panel into; identity is asserted. */
const BODY = { name: 'body' }

/**
 * `react-dom` stand-in: `createPortal` records its container and keeps the
 * overlay as the only child, so the tree walker still reaches the panel while
 * the test can tell it was portaled to `BODY` rather than left in the dock.
 */
const ReactDOM = {
  createPortal(node, container) {
    return { type: 'portal', props: { container }, children: [node] }
  },
}

/** Run the bundle and return the module it registered. */
function loadBundle(React) {
  let captured = null
  const windowStub = {
    innerWidth: 1440,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: {
      load({ id, factory }) {
        captured = { id, factory }
      },
    },
  }
  const documentStub = {
    body: BODY,
    addEventListener() {},
    removeEventListener() {},
  }
  new Function('window', 'document', SOURCE)(windowStub, documentStub)
  assert.ok(captured !== null, 'bundle registered no module')
  return captured.factory((id) => (id === 'react-dom' ? ReactDOM : React))
}

/**
 * Register the entry the way the Host does, and hand back the component it
 * seats in the dock slot. `apply` is exercised for real: a bundle that throws
 * while registering fails here instead of in the page.
 */
function loadEntry(React) {
  const module = loadBundle(React)
  let component = null
  module.apply({
    effect(run) {
      run()
    },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject(name, run) {
        run()
      },
      register(config, seat) {
        component = seat
        return () => {}
      },
    },
  })
  assert.equal(typeof component, 'function', 'apply registered no component')
  return { module, component }
}

/**
 * Minimal hook runtime: one component instance, real `useState` updates, and
 * effects that run after a render with dependency comparison. `useCallback`
 * memoizes like React's, because the load effect depends on a stable callback —
 * a stub that re-creates it every render would loop on `fetch`.
 */
function createRuntime() {
  const cells = []
  let index = 0
  let dirty = false
  let queued = []

  const depsEqual = (left, right) => {
    if (left === undefined || right === undefined) return false
    return left.length === right.length && left.every((value, at) => Object.is(value, right[at]))
  }

  const queueEffect = (fn, deps) => {
    const at = index++
    const cell = cells[at] ?? (cells[at] = { deps: undefined, cleanup: undefined })
    if (cell.deps !== undefined && depsEqual(cell.deps, deps)) return
    cell.deps = deps
    queued.push(() => {
      if (typeof cell.cleanup === 'function') cell.cleanup()
      const cleanup = fn()
      cell.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    })
  }

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useRef(initial) {
      const at = index++
      if (cells[at] === undefined) cells[at] = { current: initial }
      return cells[at]
    },
    useState(initial) {
      const at = index++
      if (cells[at] === undefined) {
        cells[at] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const cell = cells[at]
      return [cell.value, (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next
        if (Object.is(value, cell.value)) return
        cell.value = value
        dirty = true
      }]
    },
    useCallback(fn, deps) {
      const at = index++
      const cell = cells[at] ?? (cells[at] = { fn: undefined, deps: undefined })
      if (cell.fn === undefined || !depsEqual(cell.deps, deps)) {
        cell.fn = fn
        cell.deps = deps
      }
      return cell.fn
    },
    useId() {
      index += 1
      return 'mmq-test'
    },
    useEffect: queueEffect,
    useLayoutEffect: queueEffect,
  }

  return {
    React,
    /** Render once and return the element tree. */
    render(component, props) {
      index = 0
      return component(props)
    },
    /** Run the effects queued by the last render. */
    flush() {
      const running = queued
      queued = []
      for (const effect of running) effect()
    },
    /**
     * Drop every hook cell, the way a real unmount would, while keeping the
     * module — and therefore its module-level state — alive. Rendering again
     * afterwards is a fresh mount of the same bundle.
     */
    unmount() {
      cells.length = 0
      queued = []
      index = 0
      dirty = false
    },
    get dirty() {
      return dirty
    },
    reset() {
      dirty = false
    },
  }
}

/** A `t` that behaves like the locale seat: lookup plus `{name}` interpolation. */
const DICTIONARY = {
  'pill.title': '模型用量',
  'pill.loading': '读取中…',
  'pill.failed': '额度不可用',
  'pill.none': '暂无数据',
  'pill.window': '5h',
  'pill.week': '周',
  'pill.month': '月',
  'pill.used': '已用 {percent}%',
  'pill.balance': '余额',
  'pill.balanceFailed': '余额不可用',
  'panel.title': 'MiniMax 额度',
  'panel.opencodeTitle': 'OpenCode 额度',
  'panel.updated': '更新于 {time}',
  'panel.refresh': '刷新',
  'panel.refreshing': '刷新中…',
  'panel.empty': 'MiniMax 没有返回额度数据。',
  'panel.opencodeEmpty': 'OpenCode 没有返回额度数据。',
  'panel.interval': '当前窗口',
  'panel.weekly': '本周',
  'panel.rolling': '滚动窗口',
  'panel.monthly': '本月',
  'panel.resetsIn': '{duration}后重置',
  'panel.counts': '已用 {used} / {total}',
  'duration.minutes': '{minutes} 分钟',
  'duration.hours': '{hours} 小时 {minutes} 分钟',
  'duration.days': '{days} 天 {hours} 小时',
  'model.general': '通用模型',
  'error.notConfigured': '尚未配置凭据 {ref}，请先在该提供方的设置里填入 API 密钥。',
  'error.unreachable': '无法连接该提供方：{message}',
  'error.upstreamError': '该提供方返回错误：{message}',
  'error.client': '读取用量失败：{message}',
}

const t = (key, params = {}) =>
  (DICTIONARY[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))

/** Props as the component sees them, including `children` from the third argument. */
function propsOf(node) {
  const children = node.children.length <= 1 ? node.children[0] : node.children
  return node.children.length === 0 ? node.props : { ...node.props, children }
}

/** Every text node under one element tree, resolving function components. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(node.type(propsOf(node)))
  // Element siblings are separated by the pill's flex gap, not by text; a
  // space keeps assertions readable without pretending the DOM has one.
  return node.children.map(textOf).join(' ')
}

/** Depth-first search for every element matching a predicate. */
function findAll(node, predicate, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  if (typeof node.type === 'function') {
    findAll(node.type(propsOf(node)), predicate, found)
    return found
  }
  for (const child of node.children ?? []) findAll(child, predicate, found)
  return found
}

const HOUR = 3_600_000

/** An OpenCode reading shaped like the Host route's success body. */
function opencodeBody() {
  return {
    ok: true,
    fetchedAt: Date.now(),
    windows: {
      rolling: { usedPercent: 4, resetsAt: Date.now() + 2 * HOUR, resetsInMs: 2 * HOUR },
      weekly: { usedPercent: 38, resetsAt: Date.now() + 72 * HOUR, resetsInMs: 72 * HOUR },
      monthly: { usedPercent: 82, resetsAt: Date.now() + 200 * HOUR, resetsInMs: 200 * HOUR },
    },
  }
}

/** A MiniMax reading shaped like the Host route's success body. */
function minimaxBody() {
  return {
    ok: true,
    fetchedAt: Date.now(),
    entries: [{
      model: 'general',
      interval: { remainingPercent: 22, used: 78, total: 100, resetsInMs: 3 * HOUR, resetsAt: null, status: 1 },
      weekly: { remainingPercent: 60, used: 40, total: 100, resetsInMs: 96 * HOUR, resetsAt: null, status: 1 },
    }],
  }
}

/** Settle the render/effect/fetch cycle for one mount. */
async function settle(runtime, render) {
  let tree = null
  for (let round = 0; round < 40; round += 1) {
    runtime.reset()
    tree = render()
    runtime.flush()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!runtime.dirty) break
  }
  return tree
}

/**
 * Mount the dock entry for one provider with a scripted response.
 * @param {string} provider - the provider id the projection reports.
 * @param {object|Error} body - the route body, or an Error to reject `fetch`.
 */
async function mount(provider, body) {
  const runtime = createRuntime()
  const entry = loadEntry(runtime.React)
  const requests = []
  globalThis.fetch = (url) => {
    requests.push(url)
    if (body instanceof Error) return Promise.reject(body)
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }
  const props = {
    t,
    useProjection: (key, selector) => selector({ next: { provider } }),
  }
  const mounted = { runtime, entry, props, requests, tree: null }
  mounted.tree = await settle(runtime, () => runtime.render(entry.component, props))
  return mounted
}

/** Open the detail panel by pressing the pill, then settle again. */
async function expand(mounted) {
  const button = findAll(mounted.tree, (node) => node.type === 'button')[0]
  assert.ok(button !== undefined, 'the pill rendered no button')
  button.props.onClick()
  mounted.tree = await settle(mounted.runtime, () =>
    mounted.runtime.render(mounted.entry.component, mounted.props))
  return mounted.tree
}

test('an opencode-go session shows three consumed windows', async () => {
  const mounted = await mount('opencode-go', opencodeBody())
  assert.deepEqual(mounted.requests, ['opencode-quota'])
  const pill = findAll(mounted.tree, (node) => node.props.className === 'mmq-pill')[0]
  assert.match(textOf(pill), /5h 4%/)
  assert.match(textOf(pill), /周 38%/)
  assert.match(textOf(pill), /月 82%/)
  // The monthly window is the worst one, so its figure carries the error tone.
  const values = findAll(pill, (node) => String(node.props.className).startsWith('mmq-value'))
  assert.equal(values.at(-1).props.className, 'mmq-value mmq-tone-error')
  assert.equal(findAll(pill, (node) => node.type === 'button').length, 1)
})

test('the opencode panel lists the three windows with reset countdowns', async () => {
  const mounted = await mount('opencode-go', opencodeBody())
  const tree = await expand(mounted)
  const panel = findAll(tree, (node) => node.props.className === 'mmq-panel')[0]
  assert.ok(panel !== undefined, 'no panel was rendered')
  assert.match(textOf(panel), /OpenCode 额度/)
  assert.match(textOf(panel), /滚动窗口/)
  assert.match(textOf(panel), /本周/)
  assert.match(textOf(panel), /本月/)
  assert.match(textOf(panel), /已用 4%/)
  assert.match(textOf(panel), /2 小时 0 分钟后重置/)
  const bars = findAll(panel, (node) => node.props.role === 'progressbar')
  assert.deepEqual(bars.map((bar) => bar.props['aria-valuenow']), [4, 38, 82])
})

test('the detail panel is portaled to document.body, not left inside the dock', async () => {
  // The composer is the containing block for fixed descendants, so a panel
  // rendered in the dock anchors to the composer and never shows. The pill
  // stays in the dock; the overlay must leave it.
  const mounted = await mount('opencode-go', opencodeBody())
  const closed = findAll(mounted.tree, (node) => node.type === 'portal')
  assert.equal(closed.length, 0, 'no overlay is mounted while the panel is closed')

  const tree = await expand(mounted)
  const portals = findAll(tree, (node) => node.type === 'portal')
  assert.equal(portals.length, 1, 'the open panel is mounted through exactly one portal')
  assert.equal(portals[0].props.container, BODY, 'the portal targets document.body')
  const panel = findAll(portals[0], (node) => node.props.className === 'mmq-panel')[0]
  assert.ok(panel !== undefined, 'the portal carries the panel')
  // The pill and its style stay in the dock; only the overlay moved out.
  const pillInDock = findAll(tree, (node) => node.props.className === 'mmq-pill')
  assert.equal(pillInDock.length, 1)
  assert.equal(findAll(portals[0], (node) => node.props.className === 'mmq-pill').length, 0)
})

test('a missing opencode window is skipped, not rendered as zero', async () => {
  const body = opencodeBody()
  delete body.windows.monthly
  const mounted = await mount('opencode-go', body)
  const pill = findAll(mounted.tree, (node) => node.props.className === 'mmq-pill')[0]
  assert.match(textOf(pill), /周 38%/)
  assert.doesNotMatch(textOf(pill), /月 /)
  const tree = await expand(mounted)
  assert.doesNotMatch(textOf(tree), /本月/)
})

test('a failed opencode read shows the localized reason in the panel', async () => {
  const mounted = await mount('opencode-go', {
    ok: false,
    code: 'not-configured',
    ref: 'OPENCODE_GO_API_KEY',
    message: 'No credential is configured for OPENCODE_GO_API_KEY.',
  })
  const pill = findAll(mounted.tree, (node) => node.props.className === 'mmq-pill')[0]
  assert.match(textOf(pill), /额度不可用/)
  const tree = await expand(mounted)
  assert.match(textOf(tree), /尚未配置凭据 OPENCODE_GO_API_KEY/)
})

test('a transport failure still renders a pill instead of throwing', async () => {
  const mounted = await mount('opencode-go', new Error('connection refused'))
  const pill = findAll(mounted.tree, (node) => node.props.className === 'mmq-pill')[0]
  assert.match(textOf(pill), /额度不可用/)
  const tree = await expand(mounted)
  assert.match(textOf(tree), /读取用量失败：connection refused/)
})

test('a minimax session keeps its two peak figures and per-model rows', async () => {
  const mounted = await mount('minimax-cn', minimaxBody())
  assert.deepEqual(mounted.requests, ['minimax-quota'])
  const pill = findAll(mounted.tree, (node) => node.props.className === 'mmq-pill')[0]
  // MiniMax reports remaining percentages; the pill prints consumed ones.
  assert.match(textOf(pill), /5h 78%/)
  assert.match(textOf(pill), /周 40%/)
  const tree = await expand(mounted)
  assert.match(textOf(tree), /MiniMax 额度/)
  assert.match(textOf(tree), /当前窗口/)
  assert.match(textOf(tree), /已用 78 \/ 100/)
})

test('a deepseek session shows the wallet and polls its own route', async () => {
  const mounted = await mount('deepseek', {
    ok: true,
    fetchedAt: Date.now(),
    wallets: [{ currency: 'CNY', total: '5.00', granted: '0', toppedUp: '5.00' }],
  })
  assert.deepEqual(mounted.requests, ['deepseek-balance'])
  // The balance view renders as a static span, not a trigger.
  const pill = findAll(mounted.tree, (node) => String(node.props.className).startsWith('mmq-pill'))[0]
  assert.ok(String(pill.props.className).includes('mmq-static'))
  assert.match(textOf(pill), /¥5\.00/)
  assert.equal(findAll(mounted.tree, (node) => node.type === 'button').length, 0)
})

test('an unrelated provider renders nothing and never polls', async () => {
  const mounted = await mount('anthropic', { ok: true })
  assert.equal(mounted.tree, null)
  assert.deepEqual(mounted.requests, [])
})

test('no provider projection falls back to the minimax view', async () => {
  const runtime = createRuntime()
  const entry = loadEntry(runtime.React)
  const requests = []
  globalThis.fetch = (url) => {
    requests.push(url)
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(minimaxBody())) })
  }
  const tree = await settle(runtime, () => runtime.render(entry.component, { t }))
  assert.deepEqual(requests, ['minimax-quota'])
  assert.equal(findAll(tree, (node) => node.props.className === 'mmq-pill').length, 1)
})

/** Props for one mount, including the provider the projection reports. */
function propsFor(provider) {
  return {
    t,
    useProjection: (key, selector) => selector({ next: { provider } }),
  }
}

test('a remount paints the last reading before the route answers', async () => {
  const runtime = createRuntime()
  const entry = loadEntry(runtime.React)
  const requests = []
  globalThis.fetch = (url) => {
    requests.push(url)
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(minimaxBody())) })
  }
  const props = propsFor('minimax-cn')
  await settle(runtime, () => runtime.render(entry.component, props))
  assert.deepEqual(requests, ['minimax-quota'])

  // Switching away and back is a remount of the same bundle. This time the
  // route is slow enough that a blank first frame would be visible.
  runtime.unmount()
  globalThis.fetch = (url) => {
    requests.push(url)
    return new Promise(() => {})
  }
  const firstFrame = runtime.render(entry.component, props)
  const pill = findAll(firstFrame, (node) => node.props.className === 'mmq-pill')[0]
  assert.match(textOf(pill), /5h 78%/)
  assert.match(textOf(pill), /周 40%/)
  assert.doesNotMatch(textOf(pill), /读取中/)

  // The revalidation still runs behind the painted numbers.
  runtime.flush()
  assert.deepEqual(requests, ['minimax-quota', 'minimax-quota'])
})

test('a failed read drops the remembered answer instead of resurrecting it', async () => {
  const runtime = createRuntime()
  const entry = loadEntry(runtime.React)
  const props = propsFor('minimax-cn')
  globalThis.fetch = () => Promise.resolve({
    status: 200,
    text: () => Promise.resolve(JSON.stringify(minimaxBody())),
  })
  await settle(runtime, () => runtime.render(entry.component, props))

  // The next read fails; the pill must say so rather than keep painting quota.
  runtime.unmount()
  globalThis.fetch = () => Promise.resolve({
    status: 503,
    text: () => Promise.resolve(JSON.stringify({ ok: false, code: 'unreachable', message: 'timeout' })),
  })
  const failed = await settle(runtime, () => runtime.render(entry.component, props))
  assert.match(textOf(failed), /额度不可用/)

  // And a later mount starts blank: the stale numbers are gone for good.
  runtime.unmount()
  globalThis.fetch = () => new Promise(() => {})
  const nextMount = runtime.render(entry.component, props)
  const pill = findAll(nextMount, (node) => node.props.className === 'mmq-pill')[0]
  assert.match(textOf(pill), /读取中/)
})
