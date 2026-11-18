/**
 * Host half of the model-usage bundle: MiniMax coding-plan quota, the DeepSeek
 * wallet balance and the OpenCode Go plan allowance.
 *
 * No provider API key ever leaves this file: each is read per request through
 * the composition's `credentials` service, used once against its provider, and
 * dropped. The browser half reaches the results through same-origin GET routes
 * on the web server, so no credential and no Host service is exposed to the page.
 *
 * `credentials` is injected onto the `ctx.inject` scope, never onto the outer
 * plugin context, so every read receives that service as an argument.
 */

/** Exact web-server routes the browser half polls. */
export const QUOTA_ENDPOINT = '/minimax-quota';
export const BALANCE_ENDPOINT = '/deepseek-balance';
export const OPENCODE_ENDPOINT = '/opencode-quota';

/**
 * Values a row's `config:` block may override.
 *
 * `models` defaults to the text-model bucket alone: MiniMax reports a separate
 * `video` allowance that this plugin does not display, and filtering here keeps
 * the unused row out of the payload entirely rather than hiding it in the view.
 * Set `models: []` to show every bucket MiniMax returns.
 */
const DEFAULTS = {
  apiKeyEnv: 'MINIMAX_CN_API_KEY',
  endpoint: 'https://www.minimaxi.com/v1/token_plan/remains',
  deepseekApiKeyEnv: 'DEEPSEEK_API_KEY',
  deepseekEndpoint: 'https://api.deepseek.com/user/balance',
  opencodeApiKeyEnv: 'OPENCODE_GO_API_KEY',
  opencodeEndpoint: 'https://opencode.ai/zen/go/v1/usage',
  timeoutMs: 8000,
  // Long enough that the pill's 30 s poll resolves from this cache, so only
  // every second poll is an upstream read, and a conversation switch inside a
  // minute never waits on the proxy.
  cacheMs: 60_000,
  // Read every configured provider once after boot, so the first conversation's
  // pill finds a cached answer instead of a cold TLS handshake.
  warmOnStart: true,
  models: ['general'],
};

/**
 * The windows the OpenCode Go gateway meters, in the order the panel shows
 * them. The gateway answers `{ usage: { <window>: { status, percent,
 * resetsAt } } }`; any window not named here is dropped rather than forwarded,
 * because the browser has a label table and a nameless row would render blank.
 */
const OPENCODE_WINDOWS = ['rolling', 'weekly', 'monthly'];

/** @returns whether the value is a plain object we can read keys from. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * DeepSeek sends money as decimal strings ("5.00"). They pass through
 * untouched so the browser prints exactly what the account holds, with no
 * float rounding on the way.
 * @param {unknown} value - the raw field.
 * @returns {string} the amount, or '' when it is not a decimal string.
 */
function amountOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  return '';
}

/** @returns the number clamped into range, or the fallback when unusable. */
function bounded(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** @returns the finite number, or null when MiniMax left the field out. */
function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @returns a readable message for an unknown thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/**
 * @param {unknown} value - an ISO timestamp from the gateway.
 * @returns {number|null} the same instant in epoch milliseconds, or null when
 * it does not parse — the browser formats this value, so it never sees garbage.
 */
function epochOf(value) {
  if (typeof value !== 'string' || value === '') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/**
 * One OpenCode Go window, normalized onto the shape the browser renders.
 *
 * The gateway's `percent` is the share **already consumed**, unlike MiniMax's
 * `*_remaining_percent`, so it passes through as `usedPercent` and the view
 * never has to invert it. `resetsInMs` is derived here, once, so the countdown
 * does not depend on the page's clock agreeing with this process.
 *
 * @param {unknown} entry - one `usage.<window>` object.
 * @param {number} now - the read's timestamp.
 * @returns {object|null} the normalized window, or null when unusable.
 */
function normalizeOpencodeWindow(entry, now) {
  if (!isRecord(entry)) return null;
  const percent = numberOrNull(entry.percent);
  const resetsAt = epochOf(entry.resetsAt);
  return {
    usedPercent: percent === null ? null : Math.min(100, Math.max(0, percent)),
    resetsAt,
    resetsInMs: resetsAt === null ? null : Math.max(0, resetsAt - now),
  };
}

/**
 * One MiniMax quota window, normalized. `total` stays null when MiniMax reports
 * an unlimited window (it sends 0), so the browser never prints "0 of 0".
 * @param {Record<string, unknown>} row - one `model_remains` entry.
 * @param {'interval'|'weekly'} kind - which window of that entry to read.
 * @returns {object} the normalized window.
 */
function normalizeWindow(row, kind) {
  const weekly = kind === 'weekly';
  const total = numberOrNull(weekly ? row.current_weekly_total_count : row.current_interval_total_count);
  const usage = numberOrNull(weekly ? row.current_weekly_usage_count : row.current_interval_usage_count);
  const endTime = numberOrNull(weekly ? row.weekly_end_time : row.end_time);
  const remains = numberOrNull(weekly ? row.weekly_remains_time : row.remains_time);
  return {
    remainingPercent: numberOrNull(
      weekly ? row.current_weekly_remaining_percent : row.current_interval_remaining_percent,
    ),
    used: usage,
    total: total !== null && total > 0 ? total : null,
    resetsInMs: remains !== null ? Math.max(0, remains) : null,
    resetsAt: endTime !== null && endTime > 0 ? endTime : null,
    status: numberOrNull(weekly ? row.current_weekly_status : row.current_interval_status),
  };
}

/**
 * @param {Record<string, unknown>} row - one `model_remains` entry.
 * @returns {object} the normalized quota entry the browser renders.
 */
function normalizeEntry(row) {
  return {
    model: typeof row.model_name === 'string' && row.model_name !== '' ? row.model_name : 'unknown',
    interval: normalizeWindow(row, 'interval'),
    weekly: normalizeWindow(row, 'weekly'),
  };
}

/** Live JSON answer; quota is a fact that goes stale immediately. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** The composition's connection service, when the profile installs one. */
function connectionOf(ctx) {
  return typeof ctx?.get === 'function' ? ctx.get('connection') : undefined;
}

/**
 * A success-only cached reader with in-flight coalescing, so a burst of page
 * polls costs one upstream request and `?refresh=1` bypasses the cache.
 * @param {() => Promise<object>} fetchJson - one uncached upstream read.
 * @param {number} cacheMs - how long a successful answer is reused.
 * @returns {(force?: boolean) => Promise<object>} the reader.
 */
function makeReader(fetchJson, cacheMs) {
  let cached = null;
  let inflight = null;
  return async function read(force) {
    if (!force && cached !== null && Date.now() - cached.at < cacheMs) return cached.payload;
    if (inflight !== null) return inflight;
    inflight = fetchJson();
    try {
      const payload = await inflight;
      if (payload.ok) cached = { at: Date.now(), payload };
      return payload;
    } finally {
      inflight = null;
    }
  };
}

/**
 * Build the browser-facing GET handler for one reader: the composition's own
 * connection fence first, then a bounded method, then the payload.
 * @param {object} scope - the injected context carrying `connection`.
 * @param {(force?: boolean) => Promise<object>} read - the cached reader.
 * @returns {(req: object, res: object) => Promise<void>} the handler.
 */
function makeHandler(scope, read) {
  return async (req, res) => {
    const connection = connectionOf(scope);
    const rejection = connection?.requestRejection?.(req);
    if (typeof rejection === 'number') {
      res.statusCode = rejection;
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET');
      res.end();
      return;
    }
    let refresh = false;
    try {
      refresh = new URL(String(req.url), 'http://localhost').searchParams.get('refresh') === '1';
    } catch {
      refresh = false;
    }
    const payload = await read(refresh);
    sendJson(res, payload.ok ? 200 : 503, payload);
  };
}

/**
 * Serve MiniMax coding-plan quota and the DeepSeek wallet balance to the page.
 * @param ctx - Host plugin context.
 * @param config - optional row config merged over {@link DEFAULTS}.
 */
export function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(isRecord(config) ? config : {}) };
  const wanted = new Set(
    (Array.isArray(settings.models) ? settings.models : []).map((model) => String(model)),
  );
  const cacheMs = bounded(settings.cacheMs, 0, 600_000, DEFAULTS.cacheMs);
  const timeoutMs = bounded(settings.timeoutMs, 1000, 60_000, DEFAULTS.timeoutMs);
  const warmOnStart = settings.warmOnStart !== false;

  /**
   * Resolve a credential reference, answering the shared not-configured shape.
   * @param {object} credentials - the injected credential service.
   * @param {string} ref - the reference name.
   * @returns {Promise<{ok: true, value: string} | object>} the value or a failure.
   */
  async function resolveKey(credentials, ref) {
    const credential = await credentials.resolve(ref);
    if (credential === undefined || credential.value === '') {
      return { ok: false, code: 'not-configured', ref, message: `No credential is configured for ${ref}.` };
    }
    return { ok: true, value: credential.value };
  }

  /**
   * One authenticated GET, normalized onto the shared failure shapes.
   * @param {object} input - endpoint, bearer value and the label used in text.
   * @returns {Promise<object>} the upstream body or a failure payload.
   */
  async function fetchJson(input) {
    let response;
    try {
      response = await fetch(input.endpoint, {
        headers: { authorization: `Bearer ${input.bearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, code: 'unreachable', message: `${input.label} is unreachable: ${messageOf(error)}` };
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      return { ok: false, code: 'upstream-error', status: response.status, message: `${input.label} answered ${response.status}.` };
    }
    if (body === undefined) {
      return { ok: false, code: 'upstream-error', status: response.status, message: `${input.label} sent an unreadable body.` };
    }
    return { ok: true, body };
  }

  /**
   * Ask MiniMax for the current quota with a freshly resolved credential.
   * @param {{ resolve(ref: string): Promise<{ value: string } | undefined> }} credentials
   *   the injected credential service; passed in because the plugin context
   *   outside `ctx.inject` does not carry it.
   * @returns {Promise<object>} the payload the browser renders.
   */
  async function queryMinimax(credentials) {
    const key = await resolveKey(credentials, settings.apiKeyEnv);
    if (!key.ok) return key;
    const result = await fetchJson({ endpoint: settings.endpoint, bearer: key.value, label: 'MiniMax' });
    if (!result.ok) return result;

    const body = result.body;
    const envelope = isRecord(body) && isRecord(body.base_resp) ? body.base_resp : undefined;
    if (envelope !== undefined && envelope.status_code !== 0) {
      const detail = typeof envelope.status_msg === 'string' ? envelope.status_msg : undefined;
      return {
        ok: false,
        code: 'upstream-error',
        message: detail ?? 'MiniMax rejected the quota request.',
      };
    }

    const rows = isRecord(body) && Array.isArray(body.model_remains) ? body.model_remains : [];
    const entries = rows
      .filter(isRecord)
      .map(normalizeEntry)
      .filter((entry) => wanted.size === 0 || wanted.has(entry.model));
    return { ok: true, fetchedAt: Date.now(), entries };
  }

  /**
   * Ask DeepSeek for the wallet balance behind the same API key.
   *
   * Amounts stay strings exactly as DeepSeek sends them; the browser decides
   * which wallet to feature and formats it, so no rounding happens here.
   *
   * @param {{ resolve(ref: string): Promise<{ value: string } | undefined> }} credentials
   *   the injected credential service.
   * @returns {Promise<object>} the payload the browser renders.
   */
  async function queryDeepseek(credentials) {
    const key = await resolveKey(credentials, settings.deepseekApiKeyEnv);
    if (!key.ok) return key;
    const result = await fetchJson({
      endpoint: settings.deepseekEndpoint,
      bearer: key.value,
      label: 'DeepSeek',
    });
    if (!result.ok) return result;

    const body = result.body;
    const infos = isRecord(body) && Array.isArray(body.balance_infos) ? body.balance_infos : [];
    const wallets = infos.filter(isRecord).map((info) => ({
      currency: typeof info.currency === 'string' ? info.currency : 'CNY',
      total: amountOf(info.total_balance),
      granted: amountOf(info.granted_balance),
      toppedUp: amountOf(info.topped_up_balance),
    }));
    if (wallets.length === 0) {
      return { ok: false, code: 'upstream-error', message: 'DeepSeek returned no wallet.' };
    }
    return { ok: true, fetchedAt: Date.now(), wallets };
  }

  /**
   * Ask the OpenCode Go gateway for the plan's three usage windows.
   *
   * The gateway reports only a percentage per window — no token counts and no
   * dollar amounts — so the payload carries exactly what the view can print.
   * A key without a Go subscription still answers, but with no `usage` object;
   * that is a read failure, not an empty quota, so it maps to `upstream-error`.
   *
   * @param {{ resolve(ref: string): Promise<{ value: string } | undefined> }} credentials
   *   the injected credential service.
   * @returns {Promise<object>} the payload the browser renders.
   */
  async function queryOpencode(credentials) {
    const key = await resolveKey(credentials, settings.opencodeApiKeyEnv);
    if (!key.ok) return key;
    const result = await fetchJson({
      endpoint: settings.opencodeEndpoint,
      bearer: key.value,
      label: 'OpenCode',
    });
    if (!result.ok) return result;

    const body = result.body;
    const usage = isRecord(body) && isRecord(body.usage) ? body.usage : undefined;
    const now = Date.now();
    const windows = {};
    for (const name of OPENCODE_WINDOWS) {
      const window = usage === undefined ? null : normalizeOpencodeWindow(usage[name], now);
      if (window !== null) windows[name] = window;
    }
    if (Object.keys(windows).length === 0) {
      return { ok: false, code: 'upstream-error', message: 'OpenCode returned no usage window.' };
    }
    return { ok: true, fetchedAt: now, windows };
  }

  ctx.inject(['webServer', 'credentials'], (scope) => {
    const readQuota = makeReader(() => queryMinimax(scope.credentials), cacheMs);
    const readBalance = makeReader(() => queryDeepseek(scope.credentials), cacheMs);
    const readOpencode = makeReader(() => queryOpencode(scope.credentials), cacheMs);

    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: QUOTA_ENDPOINT,
          handler: makeHandler(scope, readQuota),
        }),
      `model-usage: GET ${QUOTA_ENDPOINT}`,
    );
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: BALANCE_ENDPOINT,
          handler: makeHandler(scope, readBalance),
        }),
      `model-usage: GET ${BALANCE_ENDPOINT}`,
    );
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: OPENCODE_ENDPOINT,
          handler: makeHandler(scope, readOpencode),
        }),
      `model-usage: GET ${OPENCODE_ENDPOINT}`,
    );

    // Boot-time warm-up. The first conversation's pill mounts a few seconds
    // after the page loads, and a cold read there pays for the profile's proxy
    // tunnel plus a TLS handshake before anything can paint. Reading every
    // provider once, off the boot path, turns that first mount into a cache
    // hit; a provider with no configured credential stops at
    // `not-configured` without touching the network.
    //
    // Deferred one turn and cancellable, so nothing is read before the boot
    // finishes registering routes and disposing this plugin never leaves a
    // request behind.
    if (warmOnStart) {
      scope.effect(() => {
        let live = true;
        const timer = setTimeout(() => {
          if (!live) return;
          for (const read of [readQuota, readBalance, readOpencode]) {
            // The readers already fold transport failures into a payload; the
            // catch only guards a rejection they cannot produce today.
            void read().catch(() => {});
          }
        }, 0);
        return () => {
          live = false;
          clearTimeout(timer);
        };
      }, 'model-usage: warm the quota readers');
    }
  });
}
