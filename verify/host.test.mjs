/**
 * Offline harness for `index.js` — the Host half.
 *
 * It drives the real `apply` against a fake composition (credentials, web
 * server, effects), a fake `ServerResponse` and a stubbed `fetch`, so the
 * route contract, the window normalization and the cache are exercised without
 * a running harness or a real API key.
 *
 * Every test below passes `warmOnStart: false`: the boot-time warm-up is a
 * background read of its own, and these tests assert exact `fetch` counts while
 * driving the routes by hand. The warm-up has its own tests at the end.
 *
 * Run with: node --test verify/host.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { BALANCE_ENDPOINT, OPENCODE_ENDPOINT, QUOTA_ENDPOINT, apply } from '../index.js'

/** A minimal `ServerResponse` that records what the handler wrote. */
function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      res.headers[name] = value
    },
    end(body) {
      res.body = body ?? ''
    },
  }
  return res
}

/** A request object as the web server hands it over. */
function fakeRequest(path, method = 'GET') {
  return { method, url: path }
}

/**
 * Build the composition the plugin expects and collect the routes it registers.
 * @param {object} options - `keys` maps a credential reference to its value.
 */
function fakeComposition({ keys = {}, connection } = {}) {
  const routes = new Map()
  const scope = {
    credentials: {
      async resolve(ref) {
        const value = keys[ref]
        return value === undefined ? undefined : { value }
      },
    },
    webServer: {
      register(config) {
        routes.set(config.path, config)
        return () => routes.delete(config.path)
      },
    },
    effect(run) {
      run()
      return () => {}
    },
    get(name) {
      return name === 'connection' ? connection : undefined
    },
  }
  const ctx = {
    inject(names, run) {
      run(scope)
    },
    effect(run) {
      run()
      return () => {}
    },
  }
  return { ctx, routes }
}

/** Replace `fetch` for one test, recording every URL it was asked for. */
function stubFetch(handler) {
  const calls = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = previous
    },
  }
}

/** A Response-like object carrying JSON. */
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

// Reset instants stay in the far future on purpose: `resetsInMs` is clamped at
// zero, so a fixture that drifts into the past would quietly stop testing the
// subtraction and start testing the clamp.
const USAGE_RESET = '2099-11-01T18:00:00.000Z'

const USAGE = {
  usage: {
    rolling: { status: 'ok', percent: 4.5, resetsAt: USAGE_RESET },
    weekly: { status: 'ok', percent: 38, resetsAt: '2099-11-04T00:00:00.000Z' },
    monthly: { status: 'warning', percent: 82, resetsAt: '2099-12-01T00:00:00.000Z' },
  },
}

test('the opencode route normalizes the three usage windows', async () => {
  const composition = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
  apply(composition.ctx, { warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  assert.ok(route !== undefined, 'no opencode route was registered')
  assert.equal(route.kind, 'exact')

  const stub = stubFetch(() => jsonResponse(USAGE))
  try {
    const res = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(res.headers['cache-control'], 'no-store')

    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.equal(typeof payload.fetchedAt, 'number')
    assert.deepEqual(Object.keys(payload.windows), ['rolling', 'weekly', 'monthly'])
    assert.equal(payload.windows.rolling.usedPercent, 4.5)
    assert.equal(payload.windows.monthly.usedPercent, 82)
    // resetsAt is an ISO instant upstream; the view gets epoch milliseconds
    // plus the remaining time measured at the read.
    assert.equal(payload.windows.rolling.resetsAt, Date.parse(USAGE_RESET))
    assert.equal(
      payload.windows.rolling.resetsInMs,
      Date.parse(USAGE_RESET) - payload.fetchedAt,
    )
    assert.equal(stub.calls.length, 1)
    assert.equal(stub.calls[0].url, 'https://opencode.ai/zen/go/v1/usage')
    assert.equal(stub.calls[0].init.headers.authorization, 'Bearer oc_test')
  } finally {
    stub.restore()
  }
})

test('a percentage outside 0..100 is clamped instead of breaking the bar', async () => {
  const composition = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
  apply(composition.ctx, { warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  const stub = stubFetch(() => jsonResponse({
    usage: {
      rolling: { percent: 130, resetsAt: '2026-11-01T18:00:00.000Z' },
      weekly: { percent: -4, resetsAt: 'not a date' },
    },
  }))
  try {
    const res = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), res)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.windows.rolling.usedPercent, 100)
    assert.equal(payload.windows.weekly.usedPercent, 0)
    assert.equal(payload.windows.weekly.resetsAt, null)
    assert.equal(payload.windows.weekly.resetsInMs, null)
    // The gateway sent no monthly window; it is absent, not zero.
    assert.equal(payload.windows.monthly, undefined)
  } finally {
    stub.restore()
  }
})

test('a body without a usage object is an upstream error, not an empty quota', async () => {
  const composition = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
  apply(composition.ctx, { warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  const stub = stubFetch(() => jsonResponse({ error: 'not a go subscriber' }))
  try {
    const res = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), res)
    assert.equal(res.statusCode, 503)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, false)
    assert.equal(payload.code, 'upstream-error')
  } finally {
    stub.restore()
  }
})

test('a missing credential answers not-configured with the reference name', async () => {
  const composition = fakeComposition({ keys: {} })
  apply(composition.ctx, { warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  const stub = stubFetch(() => jsonResponse(USAGE))
  try {
    const res = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), res)
    assert.equal(res.statusCode, 503)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, false)
    assert.equal(payload.code, 'not-configured')
    assert.equal(payload.ref, 'OPENCODE_GO_API_KEY')
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})

test('a successful reading is cached and ?refresh=1 bypasses the cache', async () => {
  const composition = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
  apply(composition.ctx, { cacheMs: 60_000, warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  const stub = stubFetch(() => jsonResponse(USAGE))
  try {
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), fakeResponse())
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), fakeResponse())
    assert.equal(stub.calls.length, 1, 'the second poll should hit the cache')
    await route.handler(fakeRequest(`${OPENCODE_ENDPOINT}?refresh=1`), fakeResponse())
    assert.equal(stub.calls.length, 2, '?refresh=1 should bypass the cache')
  } finally {
    stub.restore()
  }
})

test('a failed reading is never cached, so the next poll retries', async () => {
  const composition = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
  apply(composition.ctx, { cacheMs: 60_000, warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  let failing = true
  const stub = stubFetch(() => (failing ? jsonResponse({}, 500) : jsonResponse(USAGE)))
  try {
    const first = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), first)
    assert.equal(first.statusCode, 503)
    failing = false
    const second = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), second)
    assert.equal(second.statusCode, 200)
    assert.equal(stub.calls.length, 2)
  } finally {
    stub.restore()
  }
})

test('only GET and HEAD reach the upstream, and the trust fence wins first', async () => {
  const composition = fakeComposition({
    keys: { OPENCODE_GO_API_KEY: 'oc_test' },
    connection: { requestRejection: () => 403 },
  })
  apply(composition.ctx, { warmOnStart: false })
  const route = composition.routes.get(OPENCODE_ENDPOINT)
  const stub = stubFetch(() => jsonResponse(USAGE))
  try {
    const fenced = fakeResponse()
    await route.handler(fakeRequest(OPENCODE_ENDPOINT), fenced)
    assert.equal(fenced.statusCode, 403)

    const other = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
    apply(other.ctx, { warmOnStart: false })
    const open = other.routes.get(OPENCODE_ENDPOINT)
    const rejected = fakeResponse()
    await open.handler(fakeRequest(OPENCODE_ENDPOINT, 'POST'), rejected)
    assert.equal(rejected.statusCode, 405)
    assert.equal(rejected.headers.allow, 'GET')
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})

test('the existing minimax and deepseek routes still register and answer', async () => {
  const composition = fakeComposition({
    keys: { MINIMAX_CN_API_KEY: 'mm_test', DEEPSEEK_API_KEY: 'ds_test' },
  })
  apply(composition.ctx, { warmOnStart: false })
  assert.ok(composition.routes.has(QUOTA_ENDPOINT))
  assert.ok(composition.routes.has(BALANCE_ENDPOINT))
  assert.ok(composition.routes.has(OPENCODE_ENDPOINT))

  const stub = stubFetch((url) => (url.includes('minimaxi')
    ? jsonResponse({
      model_remains: [{
        model_name: 'general',
        current_interval_remaining_percent: 22,
        current_interval_usage_count: 78,
        current_interval_total_count: 100,
        remains_time: 3_600_000,
      }],
    })
    : jsonResponse({
      balance_infos: [{ currency: 'CNY', total_balance: '5.00', granted_balance: '0', topped_up_balance: '5.00' }],
    })))
  try {
    const quota = fakeResponse()
    await composition.routes.get(QUOTA_ENDPOINT).handler(fakeRequest(QUOTA_ENDPOINT), quota)
    const quotaPayload = JSON.parse(quota.body)
    assert.equal(quotaPayload.ok, true)
    assert.equal(quotaPayload.entries[0].interval.remainingPercent, 22)
    assert.equal(quotaPayload.entries[0].weekly.remainingPercent, null)

    const balance = fakeResponse()
    await composition.routes.get(BALANCE_ENDPOINT).handler(fakeRequest(BALANCE_ENDPOINT), balance)
    assert.equal(JSON.parse(balance.body).wallets[0].total, '5.00')
  } finally {
    stub.restore()
  }
})

/** One provider-appropriate body per URL, so all three routes can be warmed. */
function providerBody(url) {
  if (url.includes('minimaxi')) {
    return jsonResponse({
      model_remains: [{
        model_name: 'general',
        current_interval_remaining_percent: 22,
        current_interval_usage_count: 78,
        current_interval_total_count: 100,
        remains_time: 3_600_000,
      }],
    })
  }
  if (url.includes('opencode')) return jsonResponse(USAGE)
  return jsonResponse({
    balance_infos: [{ currency: 'CNY', total_balance: '5.00', granted_balance: '0', topped_up_balance: '5.00' }],
  })
}

/** Let one deferred boot task and its microtasks run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the boot warm-up reads every configured provider once', async () => {
  const composition = fakeComposition({
    keys: { MINIMAX_CN_API_KEY: 'mm_test', DEEPSEEK_API_KEY: 'ds_test', OPENCODE_GO_API_KEY: 'oc_test' },
  })
  // Installed before `apply`: the warm-up is deferred off the boot path, but it
  // must never reach a real network.
  const stub = stubFetch(providerBody)
  try {
    apply(composition.ctx, {})
    await tick()
    await tick()
    assert.deepEqual(
      stub.calls.map((call) => new URL(call.url).host).sort(),
      ['api.deepseek.com', 'opencode.ai', 'www.minimaxi.com'],
    )

    // The page's first poll now resolves from the warmed cache.
    const res = fakeResponse()
    await composition.routes.get(OPENCODE_ENDPOINT).handler(fakeRequest(OPENCODE_ENDPOINT), res)
    assert.equal(res.statusCode, 200)
    assert.equal(stub.calls.length, 3, 'the first poll should reuse the warmed answer')
  } finally {
    stub.restore()
  }
})

test('the boot warm-up never reads a provider with no configured credential', async () => {
  const composition = fakeComposition({ keys: { OPENCODE_GO_API_KEY: 'oc_test' } })
  const stub = stubFetch(providerBody)
  try {
    apply(composition.ctx, {})
    await tick()
    await tick()
    assert.deepEqual(stub.calls.map((call) => call.url), ['https://opencode.ai/zen/go/v1/usage'])

    // And the unconfigured route still answers without touching the network.
    const res = fakeResponse()
    await composition.routes.get(QUOTA_ENDPOINT).handler(fakeRequest(QUOTA_ENDPOINT), res)
    assert.equal(JSON.parse(res.body).code, 'not-configured')
    assert.equal(stub.calls.length, 1)
  } finally {
    stub.restore()
  }
})
