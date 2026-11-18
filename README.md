# @local/dsh-model-usage

在 Harness Web 界面里显示 **模型用量**的插件包，按当前会话选中的 provider 自动切换：

| provider | 显示 |
|---|---|
| 含 `minimax` | 编程套餐额度：`图标 5h 78% · 周 22%`，可展开看各窗口明细 |
| 含 `opencode`（如 `opencode-go`） | Go 套餐限额：`图标 5h 1% · 周 0% · 月 0%`，可展开看三条窗口与重置倒计时 |
| 含 `deepseek` | 钱包余额：`钱包图标 ¥5.00`，不展开、不变色 |
| 其他 / 取不到 provider | 不显示（取不到时按 minimax 处理）

- 折叠形态挂在 `conversation.composer.dock` 槽位，排在宿主自带的「上下文」计量器**后面**（只给自己的根元素设 `order:1`，不动宿主 DOM）。
- 百分比是**已经用掉的比例**。
- 插件每 30 秒轮询一次，Host 对成功结果缓存 60 秒，所以每分钟真正打一次上游，中间那次是本地缓存命中；两个额度视图的展开面板里都有手动「刷新」按钮。
- 轮询只打当前 provider 对应的那条路由，切走就停。
- 切换对话会重新挂载药丸，此时**先用上一次成功的结果直接画出来**，再在后台校验；只有从来没读到过数据时才会出现「读取中…」。
- Host 在 `dsh web` 启动后会把三条路由各预热一次（没配凭据的 provider 直接跳过、不联网），所以刷新页面后第一次打开对话通常也是缓存命中。

### 这一行**无法**右对齐到输入框边缘

宿主的结构决定了这一点，不是 CSS 没调好：

```css
.uV2eYG_root { display:flex; flex-direction:column; align-items:center }
.uV2eYG_dock { display:flex; justify-content:center; gap:12px; max-width:100% }
```

dock 行的父容器是 `align-items:center` 的**列** flex 盒子，且 dock 自身没有 `width`——于是这一行**收缩到内容宽度并整体居中**。统计条目和额度药丸是同一个居中组，右边那段空白属于组外，不属于行内。

对照输入框卡片本身是 `width:100%`，所以它撑满；dock 行不是。

因此在本槽位内：

- `width:100%`、`flex:1 1 0%`、`align-items:flex-end`、`margin-left:auto` 都**无效**——它们只能决定「我在这个居中组内占多宽」，而收缩到内容的容器没有剩余空间可分配。
- 想要真正的右边缘位置，只能换到 `conversation.input.right`（输入框内、发送箭头旁），那里位置由宿主保证。

## 为什么详情是浮层

详情面板是 `position: fixed` 的浮层，锚定在药丸上——**不是**在文档流里撑开的块。

早先的版本把面板直接渲染在药丸下面，dock 一变形就把整个输入框往上顶，点一下就跳。改成浮层后它完全脱流，展开收起不影响页面任何其他元素的位置。

浮层的行为（对齐宿主自己的统计弹窗 `dsh-client-ui-chat` 的 `useStatDialog`）：

- 默认向上弹出；上方空间不足时自动翻到下方。
- 水平居中于药丸，并夹在视口内（左右各留 8px）。
- 视口缩放、任意滚动容器滚动时重新定位。
- 点击外部或按 `Esc` 关闭。
- 首次测量完成前用 `visibility:hidden` 隐藏，避免在左上角闪一下。

锚点定位、外部点击、Escape 都是本插件自己实现的，没有 import `@deepseek-ai/dsh-client-ui-primitives`（插件规范禁止）。

## 百分比的口径

药丸和展开面板里的百分比**都是已用量**，不是剩余量：

```
MiniMax：已用% = 100 - MiniMax 返回的 *_remaining_percent
OpenCode：直接用返回的 percent（网关本来就发已用比例）
```

药丸上 MiniMax 的两个数字分别是「当前窗口」和「本周」各自**跨所有模型取最大值**——也就是最吃紧的那个窗口。MiniMax 没有上报百分比的模型（例如返回 `null` 的 speech）会被跳过并显示 `—`，而不是被当成已耗尽。

OpenCode 没有「按模型」这一层：一个账号三条窗口（`rolling` 滚动 / `weekly` 本周 / `monthly` 本月），药丸直接把三条都列出来，每条各算各的。网关没返回的窗口会整条跳过，而不是画成 0。

配色按已用量分级：`< 40%` 绿、`40–75%` 橙、`>= 75%` 红。

## 文字层级与对比度

面板上的文字按「用户是否真的在读」选层级，而不是按视觉轻重。浮层背景是 `--dsw-specific-menu`（浅色 `#f8f9fa` / 深色 `#303136`），各档实测对比度：

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--dsw-alias-label-primary` | 17.93:1 | 12.42:1 | 标题、模型名 |
| `--dsw-alias-label-secondary` | 5.50:1 | 8.62:1 | 数值、**重置倒计时**、更新时间 |
| `--dsw-alias-label-tertiary` | 3.52:1 | 6.08:1 | 行标签（「当前窗口」「本周」） |
| `--dsw-alias-label-dimmed` | **1.20:1** | **1.35:1** | **只用于填充形状**（药丸左侧的降级圆点） |

`label-dimmed` 在浮层上只有 1.2:1，几乎是隐形的——早先重置倒计时用了它，结果完全看不清。现在规则是：**只用于文字的一律不低于 `secondary`**（浅色下 4.5:1 是 WCAG AA 的正文门槛），`dimmed` 仅允许做填充。


## 显示条件

药丸读取会话的 `modelSelection` 投影（`useProjection('modelSelection')`）拿到当前
provider id，然后判断：

- provider 名里含 `minimax`（如 `minimax-cn`、`minimax-global`）→ 显示 MiniMax 额度并开始轮询。
- provider 名里含 `opencode`（如 `opencode-go`）→ 显示 OpenCode Go 限额并开始轮询。
- provider 名里含 `deepseek` → 显示钱包余额并开始轮询。
- 是别的 provider（如 `anthropic`）→ **不渲染，也不轮询**。
- **取不到该投影**（composition 没提供 `useProjection`，或 selection 为 null）
  → 按「显示」处理。

最后一条是有意为之：宁可多显示，也不要因为拿不到数据就让药丸凭空消失。

## 额度是怎么读到的

**Host 半边**（`index.js`）是唯一接触密钥的代码。每次请求时，它通过 composition 的
`credentials` 服务解析对应 provider 的凭据引用（`MINIMAX_CN_API_KEY` 正是 profile 里
`minimax-cn` 这个 LLM provider 所用的那把，`OPENCODE_GO_API_KEY` 对应 `opencode-go`），
所以**不需要第二把钥匙**——然后调用：

```
GET https://www.minimaxi.com/v1/token_plan/remains
GET https://api.deepseek.com/user/balance
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <解析出的值>
```

把返回体归一化后，通过三条同源路由提供给页面：

```
GET /minimax-quota[?refresh=1]
GET /deepseek-balance[?refresh=1]
GET /opencode-quota[?refresh=1]
```

三条路由名保留了各自服务的提供方，好排查；它们是运行时地址，与包名无关。

密钥既不会下发到页面，也不做缓存。成功的响应会按 `cacheMs`（默认 60 秒）复用，
并且并发的页面轮询共用同一次上游请求。失败的响应不缓存。

插件加载后会延迟一个事件循环，把三条路由各读一次（`warmOnStart`）。这一跳的意义
在于把「凭据解析 → 代理隧道 → TLS 握手」的成本从用户第一次打开对话的时刻挪到
`dsh web` 启动之后：实测这条代理链路的握手在 0.1–5 秒之间抖动，而预热过的路由对
页面只是毫秒级的缓存命中。没有配置凭据的 provider 会停在 `not-configured`，不会联网。

页面侧也留了一份内存缓存：同一个路由上一次成功的结果会在重新挂载时**先画出来**，
再在后台校验；校验失败就丢掉这份记忆，下一次挂载仍然从「读取中…」开始——宁可显示
失败原因，也不把旧额度当成实时数据。

## 配置

所有项都有可用的默认值。要改某一项，在 profile 的 `cordis.patch.yml` 里给这一行
加一个 `config:` 块：

```yaml
- id: model-usage
  name: '@local/dsh-model-usage'
  config:
    apiKeyEnv: MINIMAX_API_KEY   # 要解析的凭据引用名
    endpoint: https://www.minimaxi.com/v1/token_plan/remains
    deepseekApiKeyEnv: DEEPSEEK_API_KEY
    deepseekEndpoint: https://api.deepseek.com/user/balance
    opencodeApiKeyEnv: OPENCODE_GO_API_KEY
    opencodeEndpoint: https://opencode.ai/zen/go/v1/usage
    timeoutMs: 8000              # 单次请求超时
    cacheMs: 60000               # 成功响应复用时长
    warmOnStart: true            # 启动后预热三条路由（false 关闭）
    models: [general]            # 默认只显示文本额度；[] 表示显示全部
```

## 三个 provider 的数据源

**MiniMax**（窗口百分比）：

```
GET https://www.minimaxi.com/v1/token_plan/remains
→ { model_remains: [{ remaining_percent, remains_time, ... }] }
```

**DeepSeek**（钱包余额）：

```
GET https://api.deepseek.com/user/balance
→ { balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
```

**OpenCode Go**（套餐限额）：

```
GET https://opencode.ai/zen/go/v1/usage
→ { usage: { rolling: { status, percent, resetsAt },
             weekly:  { status, percent, resetsAt },
             monthly: { status, percent, resetsAt } } }
```

三条窗口分别是 5 小时滚动额度、本周额度、本月额度；`percent` 是**已用**比例，
`resetsAt` 是 ISO 时刻，Host 会换算成 epoch 毫秒并算出「还有多久重置」再交给页面。
网关没返回的窗口不会被补 0，而是整条不显示。这个接口没有公开文档，字段若有变动会
落到 `upstream-error`（面板里显示原因），不会让药丸崩掉。

三者认证都用各 provider 自己在 Settings 里存的那把 API key，**不额外保存任何密钥**。

金额按 DeepSeek 发来的十进制字符串原样透传，不做浮点运算，显示的就是账户里的实际数字。面板展示「第一个有钱的钱包」——你同时有 CNY 和 USD 时不会把空的 USD 显示出来。

## 显示哪些额度

MiniMax 会在 `model_remains` 里返回多个额度桶，本账号当前是 `general`（文本）和
`video`（视频）。**视频额度不显示**，因为插件只关心你实际在用的文本额度。

过滤放在 **Host 侧**（`models` 默认 `['general']`），而不是渲染时隐藏——这样视频那个桶
根本不会进入返回给浏览器的报文：

```
upstream buckets:          ["general","video"]
default payload buckets:   ["general"]
```

想改回去就把 `models` 设为 `[]`（显示全部）或 `['video']`。注意这属于 `index.js`
的配置，**改动需要重启 `dsh web`**。

OpenCode 没有额度桶这一层，`models` 对它不起作用：网关返回哪几条窗口就显示哪几条。

`apiKeyEnv` 填的是**凭据引用名**，不是密钥本身。在「设置 → 模型 → MiniMax
provider」里配置密钥（也就是 profile 中 `minimax-cn` provider 存放它的地方），
或者通过 `dsh.credentials` 配置。OpenCode Go 同理：凭据名默认 `OPENCODE_GO_API_KEY`，
在 OpenCode Console 订阅 Go / Go Plus 后拿到 Key，写进凭据库即可。

## 验证

```
npm test        # 等价于 node --test verify/host.test.mjs verify/client.test.mjs
```

- `verify/host.test.mjs`：用假 composition（credentials / webServer / effect）、假
  `ServerResponse` 和桩 `fetch` 驱动真实的 Host 半边——三条路由的注册、OpenCode 窗口
  归一化与越界钳制、缺失窗口不补 0、`not-configured` / 上游失败映射、成功缓存与
  `?refresh=1` 绕过、失败不缓存、信任围栏与方法守卫。
- `verify/client.test.mjs`：把真实的 `client.js` 放进假 `window`、一个最小 React hook
  运行时和桩 `fetch` 里跑，检查四种 provider 的路由与渲染：OpenCode 三条窗口、缺窗口
  时跳过、失败与传输异常、MiniMax 的剩余量换算、DeepSeek 钱包、无关 provider 不渲染。
- `verify/live-opencode.mjs`：手动对真实网关跑一次 OpenCode 路由（读
  `~/.dsh/.credentials.yaml` 里的 Key，只打印归一化后的结果）。接口没有公开文档，
  怀疑字段变动时先跑它。

两个测试都不画像素，页面上的实际位置/颜色仍需在浏览器里看一眼。

## 安装

**从 GitHub 装**（换机器、给别人用）：

```
plugin_manager install_bundle  target: github:x7user/dsh-model-usage
```

`github:` 是 pnpm 认的简写，等价于 `https://github.com/x7user/dsh-model-usage`；
要钉住某个提交或标签就写 `github:x7user/dsh-model-usage#<sha 或 tag>`。
这条路是把仓库克隆进 profile 的 `node_modules`，之后上游更新**不会**自动跟过来：
重新装要走 `remove_bundle` 再 `install_bundle`。

**从本地目录装**（本机开发时用）：

```
plugin_manager install_bundle  target: E:\workspace\app\model-usage
```

profile 对这个目录是**链接**而不是拷贝，所以改文件即刻反映到页面。

装完重启 `dsh web`，重新加载 <http://127.0.0.1:3080>。

## 安装之后的修改

profile 是把这个目录**链接**进去的，因此改完文件只有**浏览器半边**是即时生效的：
`client.js` 每次刷新页面都会从这个目录重新拉取。而 `index.js` 是 Host 进程早已
import 过的 ES 模块——切换插件开关、重新执行 `install_bundle` 都不会让它重新
import，因为 dsh 的 HMR 监听忽略 `**/node_modules`，且只监听 dsh 安装目录。

所以**任何对 `index.js` 的改动都需要重启 `dsh web`** 才能生效。
