/**
 * Browser half of the model-usage bundle: one ambient pill below the composer
 * that expands into the window details. Data arrives from the Host half's
 * same-origin routes, so the page never sees an API key.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-model-usage',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /** Locale namespace this entry's dictionary and `t` seat share. */
    const NS = 'modelUsage'

    /**
     * How often the pill re-reads the Host route while it stays mounted. Kept
     * below the Host's own success cache (`cacheMs`, 60 s in `index.js`), so a
     * poll normally resolves from that cache instead of paying for an upstream
     * read: every second poll is the one that actually refreshes.
     */
    const REFRESH_MS = 30000

    /** Document-relative routes; the Host half owns the exact paths. */
    const ROUTE = 'minimax-quota'
    const DEEPSEEK_ROUTE = 'deepseek-balance'
    const OPENCODE_ROUTE = 'opencode-quota'

    /**
     * Last successful payload per route, kept for the lifetime of this bundle.
     *
     * Switching conversations remounts the dock entry, and a mount with no data
     * can only paint `pill.loading`. What sits behind that mount ranges from a
     * Host cache hit (a couple of milliseconds) to a cold proxy tunnel plus TLS
     * handshake (seconds), so the previous answer is painted immediately and
     * revalidated behind it.
     *
     * Deliberately memory-only: a reloaded page starts from live numbers, not
     * from whatever an earlier page load happened to see.
     */
    const LAST_PAYLOAD = new Map()

    /**
     * The OpenCode Go windows, in the gateway's own names and the order the
     * panel lists them. The rolling window is a 5-hour budget, which is why the
     * pill reuses the `5h` label MiniMax already uses.
     */
    const OPENCODE_WINDOWS = ['rolling', 'weekly', 'monthly']

    /** Collapsed-pill labels for those windows: 5h, week, calendar month. */
    const PILL_LABELS = { rolling: 'pill.window', weekly: 'pill.week', monthly: 'pill.month' }

    /** Currency signs, keyed by the code DeepSeek sends. */
    const CURRENCY_SIGNS = { CNY: '¥', USD: '$' }

    /**
     * The wallet glyph for the balance view. Deliberately a plain neutral mark
     * rather than a DeepSeek logo: `currentColor` keeps it on-theme in both
     * light and dark, and the plugin does not imitate a brand it has no asset for.
     */
    function WalletIcon() {
      return h(
        'svg',
        {
          className: 'mmq-icon',
          width: '15',
          height: '15',
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('rect', { x: 1.5, y: 4, width: 13, height: 9.5, rx: 2 }),
        h('path', { d: 'M11 8.75h1.6' }),
      )
    }

    /**
     * The glyph for the OpenCode view: a neutral prompt mark (`>_`), same
     * reasoning as the wallet above. OpenCode's own mark is a brand asset this
     * plugin does not ship, and a `currentColor` prompt reads as "a coding
     * agent" without pretending to be the logo.
     */
    function PromptIcon() {
      return h(
        'svg',
        {
          className: 'mmq-icon',
          width: '15',
          height: '15',
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4.3 5.5 7 8l-2.7 2.5' }),
        h('path', { d: 'M8.6 10.5h3.3' }),
      )
    }

    /**
     * Pick the wallet worth featuring: the first one actually holding money, so
     * an empty USD wallet does not get shown while a CNY wallet has a balance.
     * @param {object[]} wallets - the Host payload's wallets.
     * @returns {object | null} the wallet to display.
     */
    function featuredWallet(wallets) {
      if (!Array.isArray(wallets) || wallets.length === 0) return null
      const funded = wallets.find((wallet) => Number.parseFloat(wallet.total) > 0)
      return funded ?? wallets[0]
    }

    /**
     * The DeepSeek view: icon plus balance, nothing else. A wallet balance has
     * no window, no percentage and no threshold, so there is no detail panel to
     * open and no colour to grade.
     * @param props - payload state plus the entry's translate function.
     * @returns {React.ReactElement} the rendered pill.
     */
    function BalancePill({ payload, failed, t }) {
      const wallets = payload.ok === true ? payload.wallets : null
      const wallet = featuredWallet(wallets)
      const amount = wallet === null ? '' : wallet.total
      const sign = wallet === null ? '' : CURRENCY_SIGNS[wallet.currency] ?? `${wallet.currency} `
      const label = failed
        ? t('pill.balanceFailed')
        : wallet === null || amount === ''
          ? t('pill.loading')
          : `${sign}${amount}`
      return h(
        'span',
        { className: 'mmq-pill mmq-static', title: `${t('pill.balance')}${wallet === null ? '' : ` ${sign}${amount}`}` },
        wallet === null && !failed ? h('span', { className: 'mmq-dot mmq-tone-warn' }) : h(WalletIcon),
        h('span', { className: 'mmq-label' }, label),
      )
    }

    const DICTIONARIES = {
      zh: {
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
        'panel.unlimited': '不限量',
        'duration.minutes': '{minutes} 分钟',
        'duration.hours': '{hours} 小时 {minutes} 分钟',
        'duration.days': '{days} 天 {hours} 小时',
        'model.general': '通用模型',
        'model.video': '视频',
        'error.notConfigured': '尚未配置凭据 {ref}，请先在该提供方的设置里填入 API 密钥。',
        'error.unreachable': '无法连接该提供方：{message}',
        'error.upstreamError': '该提供方返回错误：{message}',
        'error.client': '读取用量失败：{message}',
      },
      en: {
        'pill.title': 'Model usage',
        'pill.loading': 'Loading…',
        'pill.failed': 'Quota unavailable',
        'pill.none': 'No data',
        'pill.window': '5h',
        'pill.week': 'Wk',
        'pill.month': 'Mo',
        'pill.used': '{percent}% used',
        'pill.balance': 'Balance',
        'pill.balanceFailed': 'Balance unavailable',
        'panel.title': 'MiniMax quota',
        'panel.opencodeTitle': 'OpenCode quota',
        'panel.updated': 'Updated {time}',
        'panel.refresh': 'Refresh',
        'panel.refreshing': 'Refreshing…',
        'panel.empty': 'MiniMax returned no quota data.',
        'panel.opencodeEmpty': 'OpenCode returned no usage data.',
        'panel.interval': 'Current window',
        'panel.weekly': 'This week',
        'panel.rolling': 'Rolling window',
        'panel.monthly': 'This month',
        'panel.resetsIn': 'resets in {duration}',
        'panel.counts': '{used} of {total} used',
        'panel.unlimited': 'unlimited',
        'duration.minutes': '{minutes}m',
        'duration.hours': '{hours}h {minutes}m',
        'duration.days': '{days}d {hours}h',
        'model.general': 'General models',
        'model.video': 'Video',
        'error.notConfigured': 'Credential {ref} is not configured; add that provider API key in Settings first.',
        'error.unreachable': 'Could not reach the provider: {message}',
        'error.upstreamError': 'The provider returned an error: {message}',
        'error.client': 'Could not read usage: {message}',
      },
    }

    const CSS = [
      // The composer dock renders this entry before the host's own context
      // meter, both as flex items with the default order 0. Lifting this entry
      // alone past it places the quota pill after "上下文" without touching any
      // host-owned DOM.
      //
      // This row CANNOT be right-aligned to the composer edge. The host puts it
      // in a column flex box with `align-items:center` and gives the row itself
      // no width, so the row shrinks to its content and is centred — the stats
      // and this pill are one centred group, not a full-width row with empty
      // space at the right. `align-items:flex-end` below only aligns this entry
      // WITHIN that group; no flex-basis reaches the composer's right edge, and
      // `margin-left:auto` cannot either (a shrink-to-fit box has no free space).
      // Reaching that edge needs `conversation.input.right`, which the host
      // positions for us.
      '.mmq-root{box-sizing:border-box;order:1;align-self:center;',
      'display:flex;flex-direction:column;align-items:flex-end;gap:6px;',
      'padding:6px 12px 2px;max-width:100%;',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.mmq-root *,.mmq-panel *{box-sizing:border-box}',
      '.mmq-pill{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:1px 8px;',
      'border:none;border-radius:999px;background:0 0;color:inherit;font:inherit;line-height:inherit;',
      'white-space:nowrap;cursor:pointer}',
      '.mmq-pill:hover,.mmq-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-secondary)}',
      // The balance view has nothing to expand, so it renders as a <span> and
      // must not look or behave like a trigger.
      '.mmq-static{cursor:default}',
      '.mmq-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.mmq-icon{flex:none;width:17px;height:17px;display:block;overflow:visible}',
      '.mmq-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}',
      // A tone class paints a BACKGROUND, so these fill rules are scoped to the two
      // elements that really are filled shapes. The same tone also tints TEXT on
      // .mmq-value; scoping the fill is what stops a number turning into a
      // solid block of its own colour.
      '.mmq-dot.mmq-tone-success,.mmq-bar-fill.mmq-tone-success{background:var(--dsw-alias-state-success-primary)}',
      '.mmq-dot.mmq-tone-warn,.mmq-bar-fill.mmq-tone-warn{background:var(--dsw-alias-state-warn-primary)}',
      '.mmq-dot.mmq-tone-error,.mmq-bar-fill.mmq-tone-error{background:var(--dsw-alias-state-error-primary)}',
      '.mmq-label{overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.mmq-metric{display:inline-flex;align-items:baseline;gap:3px;white-space:nowrap}',
      '.mmq-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.mmq-value.mmq-tone-success{color:var(--dsw-alias-state-success-primary);background:none}',
      '.mmq-value.mmq-tone-warn{color:var(--dsw-alias-state-warn-primary);background:none}',
      '.mmq-value.mmq-tone-error{color:var(--dsw-alias-state-error-primary);background:none}',
            // The separator is a glyph the reader sees, not a hairline rule, so it
      // takes a label tier: --dsw-alias-border-l2 (the previous choice) is a
      // border colour and rendered as a smudge. Its own margins are zero and the
      // pill's flex gap alone spaces it, which keeps the two groups tight.
      '.mmq-sep{color:var(--dsw-alias-label-tertiary);margin:0}',
      // The panel is a fixed overlay anchored to the pill, never a block in the
      // composer's flow: growing it in place pushed the composer upward. This
      // mirrors the host's own stat dialog (position: fixed, elevated menu
      // surface), with every class renamed under this plugin's prefix.
      //
      // It is portaled to document.body (see `inBody`), NOT rendered inside
      // `.mmq-root`: the composer keeps its own compositor layer, which makes it
      // the containing block for fixed descendants, so a fixed panel inside the
      // dock was placed against the composer instead of the viewport and never
      // showed. The panel therefore no longer inherits from `.mmq-root` and sets
      // the inherited text rule itself (`font-variant-numeric`).
      '.mmq-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;',
      'min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);',
      'border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));',
      'backdrop-filter:var(--dsw-menu-backdrop-filter);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);',
      'box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);',
      'border:0;padding:16px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;',
      'overflow-y:auto;overflow-x:hidden;',
      'display:flex;flex-direction:column;gap:10px;text-align:left;cursor:default}',
      '.mmq-head{display:flex;align-items:center;gap:8px;justify-content:space-between}',
      '.mmq-head-title{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.mmq-head-meta{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}',
      '.mmq-button{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:999px;',
      'border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font:inherit;',
      'cursor:pointer}',
      '.mmq-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.mmq-button:disabled{opacity:.6;cursor:default}',
      '.mmq-entry{display:flex;flex-direction:column;gap:6px}',
      '.mmq-entry-title{color:var(--dsw-alias-label-primary)}',
      '.mmq-window{display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:8px}',
      '.mmq-window-label{color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis}',
      '.mmq-bar{position:relative;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.mmq-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary)}',
      '.mmq-window-value{display:flex;flex-direction:column;align-items:flex-end;line-height:1.3}',
            // Measured on the elevated menu surface this panel uses:
      //   --dsw-alias-label-dimmed   light 1.20:1  dark 1.35:1  -> invisible
      //   --dsw-alias-label-tertiary light 3.52:1  dark 6.08:1  -> below AA
      //   --dsw-alias-label-secondary light 5.50:1 dark 8.62:1  -> clears AA
      // The countdown and the "updated at" line are information the user is
      // actively reading, so they take secondary rather than a decorative tier.
      '.mmq-window-sub{color:var(--dsw-alias-label-secondary)}',
      '.mmq-error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;word-break:break-word}',
    ].join('')

    /** @returns whether the value is a plain object. */
    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** @returns a readable message for an unknown thrown value. */
    function messageOf(error) {
      if (error instanceof Error) return error.message
      return typeof error === 'string' ? error : 'unknown error'
    }

    /**
     * @param {object|null} window - one normalized quota window.
     * @returns {number|null} the share already consumed, or null when MiniMax
     * did not report a remaining percentage for this window.
     */
    function usedPercent(window) {
      const remaining = isRecord(window) ? window.remainingPercent : null
      if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return null
      return Math.min(100, Math.max(0, 100 - remaining))
    }

    /** @returns the CSS modifier class for a consumed percentage. */
    function toneClass(used) {
      if (used >= 75) return 'mmq-tone-error'
      if (used >= 40) return 'mmq-tone-warn'
      return 'mmq-tone-success'
    }

    /**
     * The pill's two figures: the share consumed in the current window and in
     * the weekly allowance, each taken as the most consumed window across every
     * model MiniMax reports. A model with no reported percentage is skipped
     * rather than read as an exhausted window.
     * @param {object} payload - a successful Host payload.
     * @returns {{interval: number|null, weekly: number|null}} consumed shares.
     */
    function usedByWindow(payload) {
      const entries = Array.isArray(payload.entries) ? payload.entries : []
      const peak = { interval: null, weekly: null }
      for (const entry of entries) {
        for (const key of ['interval', 'weekly']) {
          const used = usedPercent(entry?.[key])
          if (used === null) continue
          if (peak[key] === null || used > peak[key]) peak[key] = used
        }
      }
      return peak
    }

    /**
     * The OpenCode windows the gateway actually reported, in panel order. A
     * window it left out is skipped rather than rendered as a zero: the plan
     * meters three windows today, but a missing one means "not reported", not
     * "nothing used".
     * @param {object} payload - a successful Host payload.
     * @returns {{name: string, window: object}[]} the reported windows.
     */
    function opencodeWindows(payload) {
      const windows = isRecord(payload) && isRecord(payload.windows) ? payload.windows : null
      if (windows === null) return []
      return OPENCODE_WINDOWS
        .filter((name) => isRecord(windows[name]))
        .map((name) => ({ name, window: windows[name] }))
    }

    /**
     * @param {object|null} window - one normalized OpenCode window.
     * @returns {number|null} the share already consumed. The gateway already
     * sends a consumed percentage, so unlike MiniMax nothing is inverted.
     */
    function opencodeUsed(window) {
      const percent = isRecord(window) ? window.usedPercent : null
      if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
      return Math.min(100, Math.max(0, percent))
    }

    /**
     * @param {number|null} ms - remaining milliseconds.
     * @param {Function} t - the entry's translate function.
     * @returns {string} a compact localized duration, or '' when unknown.
     */
    function formatDuration(ms, t) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      const minutes = Math.round(ms / 60000)
      if (minutes < 60) return t('duration.minutes', { minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('duration.hours', { hours, minutes: minutes % 60 })
      return t('duration.days', { days: Math.floor(hours / 24), hours: hours % 24 })
    }

    /** @returns the wall-clock time of an epoch millisecond value. */
    function formatClock(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''
      const date = new Date(ms)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * @param {object} state - the entry's load state.
     * @param {Function} t - the entry's translate function.
     * @returns {string} a localized explanation for a failed read.
     */
    function errorText(state, t) {
      const payload = isRecord(state.payload) ? state.payload : {}
      const message = typeof payload.message === 'string' ? payload.message : ''
      switch (payload.code) {
        case 'not-configured':
          return t('error.notConfigured', { ref: String(payload.ref ?? 'the API key') })
        case 'unreachable':
          return t('error.unreachable', { message })
        case 'upstream-error':
          return t('error.upstreamError', { message })
        default:
          return t('error.client', { message: state.clientError || message })
      }
    }

    /**
     * The MiniMax mark: four rounded strokes of varying height.
     *
     * Brand artwork keeps literal colours — the magenta-to-orange ramp is the
     * identity, not decoration — so these are the only literal values in this
     * plugin's CSS. The ramp is baked in as one colour per stroke instead of a
     * `url(#gradient)` paint server: an unresolvable gradient reference paints
     * nothing at all, and at this size the step between four sampled stops is
     * indistinguishable from a real gradient.
     *
     * The shortest stroke is deliberately kept long and every stroke is fat:
     * a thin short stroke degenerates into an invisible dot at 17px, which is
     * what the first attempt looked like. `width`/`height` are attributes as well
     * as CSS so the glyph keeps its size even if the stylesheet is absent.
     */
    const BRAND_STROKES = [
      { d: 'M2.9 6.6v5.4', color: '#E11D74' },
      { d: 'M6.3 3.8v8.8', color: '#EB4263' },
      { d: 'M9.7 2.4v11.2', color: '#F56753' },
      { d: 'M13.1 5.6v6.0', color: '#FF8C42' },
    ]

    /** Stroke width in viewBox units; also the floor a rendered bar keeps. */
    const BRAND_STROKE_WIDTH = 2.4

    function BrandIcon() {
      return h(
        'svg',
        {
          className: 'mmq-icon',
          width: '17',
          height: '17',
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
        },
        BRAND_STROKES.map((stroke) =>
          h('path', {
            key: stroke.d,
            d: stroke.d,
            stroke: stroke.color,
            strokeWidth: BRAND_STROKE_WIDTH,
            strokeLinecap: 'round',
          }),
        ),
      )
    }

    /** One `label NN%` pair inside the collapsed pill. */
    function Metric({ label, used }) {
      return h(
        'span',
        { className: 'mmq-metric' },
        h('span', { className: 'mmq-label' }, label),
        h('span', { className: `mmq-value ${used === null ? '' : toneClass(used)}` },
          used === null ? '—' : `${Math.round(used)}%`),
      )
    }

    /** `model_name` values the dictionaries name; anything else shows verbatim. */
    const KNOWN_MODELS = new Set(['general', 'video'])

    /**
     * Stand-in for a composition that publishes no `modelSelection` projection.
     * It runs the caller's selector with `undefined` so the entry reads the same
     * "capability absent" answer a real projection reader returns.
     */
    const NO_PROJECTION = (key, selector) =>
      typeof selector === 'function' ? selector(undefined) : undefined

    /**
     * One model's row: its name plus its two quota windows. The name is a
     * heading only when it distinguishes rows — a single bucket needs no label,
     * and printing one just adds a line the reader has to skip.
     */
    function EntryRow({ entry, t, showTitle }) {
      const label = KNOWN_MODELS.has(entry.model) ? t(`model.${entry.model}`) : entry.model
      return h(
        'div',
        { className: 'mmq-entry' },
        showTitle ? h('div', { className: 'mmq-entry-title' }, label) : null,
        h(WindowRow, {
          key: 'interval',
          label: t('panel.interval'),
          used: usedPercent(entry.interval),
          window: entry.interval,
          t,
        }),
        h(WindowRow, {
          key: 'weekly',
          label: t('panel.weekly'),
          used: usedPercent(entry.weekly),
          window: entry.weekly,
          t,
        }),
      )
    }

    /**
     * One quota window: name, consumed bar, percentage, counts and reset.
     *
     * `used` is passed in rather than derived, because the two providers report
     * opposite things: MiniMax sends a *remaining* percentage and OpenCode a
     * consumed one. The caller owns that conversion; this row only renders.
     */
    function WindowRow({ label, used, window, t }) {
      const parts = []
      if (isRecord(window) && typeof window.total === 'number' && typeof window.used === 'number') {
        parts.push(t('panel.counts', { used: window.used, total: window.total }))
      }
      const duration = formatDuration(isRecord(window) ? window.resetsInMs : null, t)
      if (duration !== '') parts.push(t('panel.resetsIn', { duration }))
      return h(
        'div',
        { className: 'mmq-window' },
        h('span', { className: 'mmq-window-label' }, label),
        used === null
          ? h('div', { className: 'mmq-bar' })
          : h(
            'div',
            {
              className: 'mmq-bar',
              role: 'progressbar',
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': Math.round(used),
            },
            h('div', { className: `mmq-bar-fill ${toneClass(used)}`, style: { width: `${used}%` } }),
          ),
        h(
          'span',
          { className: 'mmq-window-value' },
          h('span', null, used === null ? '—' : t('pill.used', { percent: Math.round(used) })),
          parts.length > 0 ? h('span', { className: 'mmq-window-sub' }, parts.join(' · ')) : null,
        ),
      )
    }

    /** Gap between the pill and its panel, and the smallest allowed viewport inset. */
    const PANEL_GAP = 8
    const PANEL_MARGIN = 8

    /**
     * Place a fixed panel against the trigger that opened it: above by default,
     * flipped below when the space above is too small, and nudged horizontally
     * so it never leaves the viewport. Pure arithmetic on measured values, so the
     * geometry is testable without a layout engine.
     *
     * @param {{top: number, bottom: number, left: number, width: number}} anchorRect
     *   the trigger's viewport rect.
     * @param {number} panelWidth - the panel's laid-out width.
     * @param {number} panelHeight - the panel's laid-out height.
     * @param {number} viewportWidth - window.innerWidth.
     * @param {number} viewportHeight - window.innerHeight.
     * @returns {{left: number, top: number, maxHeight: number}} viewport coordinates.
     */
    function panelPlacement(anchorRect, panelWidth, panelHeight, viewportWidth, viewportHeight) {
      const above = anchorRect.top - PANEL_GAP - panelHeight
      const flipBelow = above < PANEL_MARGIN
      const top = flipBelow ? anchorRect.bottom + PANEL_GAP : above
      const maxLeft = Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN)
      const left = Math.min(
        Math.max(PANEL_MARGIN, anchorRect.left + anchorRect.width / 2 - panelWidth / 2),
        maxLeft,
      )
      return {
        left,
        top: Math.max(PANEL_MARGIN, top),
        maxHeight: Math.max(120, (flipBelow ? viewportHeight - top : top) - PANEL_MARGIN),
      }
    }

    /**
     * Anchor a fixed-position panel to the pill. A fixed panel never joins the
     * composer's flow, so opening it moves nothing else — growing it in place
     * used to shove the composer upward.
     *
     * Reimplemented here rather than required from the UI primitives package,
     * which plugins must not import.
     *
     * @param {boolean} open - whether the panel is mounted.
     * @param {{ current: Element | null }} anchorRef - the trigger.
     * @param {{ current: Element | null }} panelRef - the panel.
     * @param {unknown} revision - re-measure when the panel's content changes.
     * @returns {{left: number, top: number, maxHeight: number} | null} placement,
     * or null until the first measurement lands.
     */
    function useAnchoredPanel(open, anchorRef, panelRef, revision) {
      const [placement, setPlacement] = React.useState(null)

      const measure = React.useCallback(() => {
        const anchor = anchorRef.current
        if (anchor === null || anchor === undefined) return
        const panel = panelRef.current
        setPlacement(
          panelPlacement(
            anchor.getBoundingClientRect(),
            panel === null || panel === undefined ? 320 : panel.offsetWidth,
            panel === null || panel === undefined ? 0 : panel.offsetHeight,
            window.innerWidth,
            window.innerHeight,
          ),
        )
      }, [anchorRef, panelRef])

      React.useLayoutEffect(() => {
        if (!open) {
          setPlacement(null)
          return undefined
        }
        measure()
        window.addEventListener('resize', measure)
        // Capture phase so a scrolling ancestor, not just the window, re-anchors.
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [open, measure, revision])

      return placement
    }

    /**
     * Close the panel on an outside pointer press or Escape.
     * @param {boolean} open - whether the panel is mounted.
     * @param {Function} setOpen - the panel's state setter.
     * @param {{ current: Element | null }} anchorRef - the trigger.
     * @param {{ current: Element | null }} panelRef - the panel.
     */
    function useDismissOnOutsidePress(open, setOpen, anchorRef, panelRef) {
      React.useEffect(() => {
        if (!open) return undefined
        const inside = (target) =>
          anchorRef.current?.contains(target) === true || panelRef.current?.contains(target) === true
        const onPointerDown = (event) => {
          if (!inside(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open, setOpen, anchorRef, panelRef])
    }

    /**
     * Mount a fixed overlay on `document.body`. The composer dock is not a safe
     * home for a `position: fixed` box: the composer owns a compositor layer, so
     * it is the containing block for fixed descendants and the panel's viewport
     * coordinates resolve against the composer instead. The host's own context
     * meter portals its panel for the same reason. Falls back to in-place
     * rendering only when no document body exists (a non-DOM test host).
     *
     * @param {React.ReactElement} node - the overlay element.
     * @returns {React.ReactElement} the element, portaled when a body exists.
     */
    function inBody(node) {
      if (typeof document === 'undefined' || !document.body) return node
      return ReactDOM.createPortal(node, document.body)
    }

    /**
     * The expanded detail card: a header (title, update clock, refresh) and
     * whatever rows the caller supplies. A failed read replaces those rows with
     * the localized reason, so neither provider has to duplicate that branch.
     */
    function Panel({ title, state, pending, onRefresh, panelId, t, panelRef, placement, children }) {
      const payload = isRecord(state.payload) ? state.payload : {}
      const clock = formatClock(payload.fetchedAt)
      return h(
        'div',
        {
          ref: panelRef,
          className: 'mmq-panel',
          id: panelId,
          role: 'group',
          'aria-label': title,
          // Hidden for the one layout pass before the first measurement, so the
          // panel never flashes at the viewport's top-left corner.
          style:
            placement === null
              ? { visibility: 'hidden', left: 0, top: 0 }
              : {
                left: `${placement.left}px`,
                top: `${placement.top}px`,
                maxHeight: `${placement.maxHeight}px`,
              },
        },
        h(
          'div',
          { className: 'mmq-head' },
          h('span', { className: 'mmq-head-title' }, title),
          h(
            'span',
            { className: 'mmq-head-meta' },
            clock === '' ? null : h('span', null, t('panel.updated', { time: clock })),
            h(
              'button',
              {
                type: 'button',
                className: 'mmq-button',
                onClick: onRefresh,
                disabled: pending,
              },
              pending ? t('panel.refreshing') : t('panel.refresh'),
            ),
          ),
        ),
        state.failed ? h('div', { className: 'mmq-error' }, errorText(state, t)) : children,
      )
    }

    /**
     * The dock entry: a compact pill that expands into the quota detail.
     * @param props - owner props plus `t`, bound because the entry declares `locale`.
     * @returns {React.ReactElement} the rendered entry.
     */
    function UsagePill(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const tRef = React.useRef(t)
      tRef.current = t
      const panelId = React.useId()
      const [open, setOpen] = React.useState(false)
      // Tagged with the provider kind it belongs to, so switching provider shows
      // a loading state instead of the previous provider's numbers.
      const [state, setState] = React.useState({ kind: null, pending: false, payload: null, failed: false, clientError: '' })
      const busy = React.useRef(false)

      // Subscribe to just the provider id, so a quota poll or a reasoning-effort
      // change never re-renders this entry. `useProjection` is a hook, so the
      // no-op fallback keeps the call unconditional and the hook order stable
      // even in a composition that omits the projection capability.
      const useProjection = typeof props.useProjection === 'function' ? props.useProjection : NO_PROJECTION
      const provider = useProjection('modelSelection', (value) => value?.next?.provider ?? null)
      // A profile may name a provider `minimax-cn`, `minimax-global`, or
      // anything else containing "minimax"; the same substring rule picks up
      // `deepseek` and `opencode` (`opencode-go`). A projection the composition
      // does not publish reads as null, which falls back to the MiniMax view
      // rather than vanishing.
      const kind =
        provider === null
          ? 'minimax'
          : /minimax/i.test(provider)
            ? 'minimax'
            : /opencode/i.test(provider)
              ? 'opencode'
              : /deepseek/i.test(provider)
                ? 'deepseek'
                : 'other'
      const relevant = kind === 'minimax' || kind === 'opencode' || kind === 'deepseek'
      const route = kind === 'deepseek' ? DEEPSEEK_ROUTE : kind === 'opencode' ? OPENCODE_ROUTE : ROUTE
      // The last answer this bundle has for the route the pill is about to read.
      // Read on every render rather than through a state initializer, because the
      // provider — and therefore the route — can change without a remount.
      const seed = LAST_PAYLOAD.get(route) ?? null

      const load = React.useCallback((refresh) => {
        if (busy.current) return
        busy.current = true
        setState((previous) => ({ ...previous, pending: true }))
        const target = refresh ? `${route}?refresh=1` : route
        fetch(target, { credentials: 'same-origin', headers: { accept: 'application/json' } })
          .then((response) => response.text().then((text) => ({ status: response.status, text })))
          .then(({ status, text }) => {
            let body = null
            try {
              body = text === '' ? null : JSON.parse(text)
            } catch {
              body = null
            }
            // An empty or non-JSON body means the Host route never answered
            // (the web server turns a handler throw into a bare 4xx), so the
            // status is the only fact worth showing.
            if (body === null || body.ok !== true) {
              // A failed read drops the remembered answer: a later mount should
              // show "读取中…" and then the reason, never yesterday's numbers
              // dressed up as live quota.
              LAST_PAYLOAD.delete(route)
              setState({
                kind,
                pending: false,
                payload: isRecord(body) ? body : null,
                failed: true,
                clientError: `HTTP ${status}`,
              })
              return
            }
            LAST_PAYLOAD.set(route, body)
            setState({ kind, pending: false, payload: body, failed: false, clientError: '' })
          })
          .catch((error) => {
            LAST_PAYLOAD.delete(route)
            setState({ kind, pending: false, payload: null, failed: true, clientError: messageOf(error) })
          })
          .then(() => {
            busy.current = false
          })
      }, [kind, route])

      React.useEffect(() => {
        // The timer is created only while this provider is the visible one, so
        // switching provider tears the poll down instead of leaving it running.
        if (!relevant) {
          setOpen(false)
          return undefined
        }
        // The balance view has no panel, so a carried-over open state must not
        // pop one open on the way back to a quota view.
        if (kind === 'deepseek') setOpen(false)
        load(false)
        const timer = setInterval(() => load(false), REFRESH_MS)
        return () => clearInterval(timer)
      }, [load, relevant, kind])

      // Both hooks run before the early return so the hook order stays stable.
      const anchorRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const placement = useAnchoredPanel(open, anchorRef, panelRef, state.payload)
      useDismissOnOutsidePress(open, setOpen, anchorRef, panelRef)

      if (!relevant) return null

      // A payload belonging to the previous provider reads as "not loaded yet",
      // so a switch never briefly shows one provider's numbers under another's.
      // A seeded payload is this provider's own last answer, so it does paint —
      // with `pending` set, which is exactly what the panel's refresh button
      // reports while the revalidation is in flight.
      const current = state.kind === kind
        ? state
        : { kind, pending: true, payload: seed, failed: false, clientError: '' }
      const payload = isRecord(current.payload) ? current.payload : {}

      if (kind === 'deepseek') {
        return h(
          'div',
          { className: 'mmq-root' },
          h('style', null, CSS),
          h(BalancePill, { payload, failed: current.failed, t }),
        )
      }

      // Both providers meter different things but share the same skeleton: a
      // window list drives both the collapsed figures and the expanded rows.
      // MiniMax is per model and reports remaining percentages; OpenCode is one
      // account with three windows and reports consumed ones. The adapters above
      // are the only place that difference lives.
      const isOpencode = kind === 'opencode'
      const windows = isOpencode && payload.ok === true ? opencodeWindows(payload) : []
      const entries = !isOpencode && payload.ok === true && Array.isArray(payload.entries)
        ? payload.entries
        : []
      const hasData = isOpencode ? windows.length > 0 : entries.length > 0
      const peak = !isOpencode && hasData ? usedByWindow(payload) : null

      const figures = isOpencode
        ? windows.map(({ name, window }) => ({
          key: name,
          label: t(PILL_LABELS[name]),
          used: opencodeUsed(window),
        }))
        : [
          { key: 'interval', label: t('pill.window'), used: peak === null ? null : peak.interval },
          { key: 'weekly', label: t('pill.week'), used: peak === null ? null : peak.weekly },
        ]

      return h(
        'div',
        { className: 'mmq-root' },
        h('style', null, CSS),
        h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: 'mmq-pill',
            'aria-expanded': open,
            'aria-controls': panelId,
            onClick: () => setOpen((value) => !value),
          },
          hasData
            ? (isOpencode ? h(PromptIcon) : h(BrandIcon))
            : h('span', { className: 'mmq-dot mmq-tone-warn' }),
          hasData
            ? figures.map((figure, index) =>
              h(
                React.Fragment,
                { key: figure.key },
                index === 0
                  ? null
                  : h('span', { className: 'mmq-sep', 'aria-hidden': true }, '·'),
                h(Metric, { label: figure.label, used: figure.used }),
              ))
            : h(
              'span',
              { className: 'mmq-label' },
              current.failed
                ? t('pill.failed')
                : payload.ok === true
                  ? t('pill.none')
                  : t('pill.loading'),
            ),
        ),
        open
          ? inBody(h(
            Panel,
            {
              key: panelId,
              panelId,
              panelRef,
              placement,
              state: current,
              pending: current.pending,
              onRefresh: () => load(true),
              title: isOpencode ? t('panel.opencodeTitle') : t('panel.title'),
              t,
            },
            hasData
              ? (isOpencode
                ? windows.map(({ name, window }) =>
                  h(WindowRow, {
                    key: name,
                    label: t(`panel.${name}`),
                    used: opencodeUsed(window),
                    window,
                    t,
                  }))
                : entries.map((entry, index) =>
                  h(EntryRow, { key: entry.model || index, entry, t, showTitle: entries.length > 1 })))
              : h(
                'div',
                { className: 'mmq-window-sub' },
                isOpencode ? t('panel.opencodeEmpty') : t('panel.empty'),
              ),
          ))
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'model-usage: dictionaries')
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'model-usage',
              order: 10,
              locale: NS,
              label: () => ctx.locale.bind(NS)('pill.title'),
            },
            UsagePill,
          ),
        )
      },
    }
  },
})
