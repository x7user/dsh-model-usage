# @local/dsh-model-usage

在 Harness Web 界面的输入框下方显示当前账号的模型用量，按会话选中的 provider 自动切换。

| provider 名含 | 药丸显示 | 可展开 |
|---|---|---|
| `minimax` | `图标 5h 78% · 周 22%` | 各额度窗口明细 |
| `opencode`（如 `opencode-go`） | `图标 5h 1% · 周 0% · 月 0%` | 三条窗口与重置倒计时 |
| `deepseek` | `钱包图标 ¥5.00` | 否 |
| 其他 | 不显示，也不轮询 | — |

## 安装

**从 GitHub 装**：

```
plugin_manager install_bundle  target: github:x7user/dsh-model-usage
```

`github:` 是 pnpm 认的简写。要钉住版本就加 `#`，例如 `#v1.2.0` 或某个 commit sha。

**从本地目录装**（本机开发时用）：

```
plugin_manager install_bundle  target: E:\workspace\app\model-usage
```

profile 对这个目录是**链接**而不是拷贝，改 `client.js` 刷新页面即可看到。

装完重启 `dsh web`，再重新加载 <http://127.0.0.1:3080>。

## 使用

- 药丸挂在 `conversation.composer.dock` 槽位，就在宿主自带的「上下文」计量器右边。
- 百分比是**已用量**，配色分三档：`< 40%` 绿、`40–75%` 橙、`≥ 75%` 红。
- 点药丸展开明细（MiniMax、OpenCode 可展开，DeepSeek 余额不展开）；面板里都有「刷新」按钮，`?refresh=1` 绕过 Host 缓存。
- 点面板外部或按 `Esc` 关闭。
- 每 30 秒自动刷新；切到别的 provider 就停止轮询。

## 工作原理

插件分两半：`index.js` 是 Host 半边的路由与上游请求，`client.js` 是页面半边的药丸与浮层。

**显示哪种视图**：Client 读会话的 `modelSelection` 投影，拿 provider 名做子串匹配（`/minimax/i`、`/opencode/i`、`/deepseek/i`）。其他 provider 不渲染也不轮询；拿不到投影时按 MiniMax 处理——宁可多显示，也不让药丸凭空消失。

**数据怎么到页面**：Host 通过 composition 的 `credentials` 服务解析凭据（引用名可配置），请求上游并归一化，再经三条同源路由提供给页面：

| 上游 | 接口 | 页面路由 |
|---|---|---|
| MiniMax | `GET https://www.minimaxi.com/v1/token_plan/remains` | `GET /minimax-quota[?refresh=1]` |
| DeepSeek | `GET https://api.deepseek.com/user/balance` | `GET /deepseek-balance[?refresh=1]` |
| OpenCode Go | `GET https://opencode.ai/zen/go/v1/usage` | `GET /opencode-quota[?refresh=1]` |

三者都用各 provider 在 Settings 里已存的那把 API key，不额外保存密钥。

**缓存**：成功的响应按 `cacheMs`（默认 60 秒）复用，并发的页面轮询共用同一次上游请求；失败的响应不缓存。启动后 Host 把三条路由各预热一次（`warmOnStart`），没配凭据的 provider 停在 `not-configured`，不联网。页面侧另有一份内存缓存：重新挂载时先画上一次的结果，再后台校验；从没成功过才显示「读取中…」。

**百分比口径**：

- MiniMax 返回的是 `*_remaining_percent`，换算式为 `已用% = 100 - remaining`；药丸上的两个数字是「当前窗口」「本周」各自**跨所有模型取最大值**（最吃紧的那个）。没上报百分比的模型跳过并显示 `—`。
- OpenCode 网关直接发已用 `percent`；三条窗口 `rolling` / `weekly` / `monthly`，分别对应 5 小时、本周、本月。网关没返回的窗口整条跳过，不补 0。
- DeepSeek 金额按返回的十进制字符串原样展示，不做浮点运算；同存多币种时显示第一个有余额的钱包。

## 配置

所有项都有默认值。要改就在 profile 的 `cordis.patch.yml` 里给这一行加 `config:` 块：

```yaml
- id: model-usage
  name: '@local/dsh-model-usage'
  config:
    apiKeyEnv: MINIMAX_CN_API_KEY
    models: [general]
    cacheMs: 60000
```

| key | 默认 | 说明 |
|---|---|---|
| `apiKeyEnv` | `MINIMAX_CN_API_KEY` | MiniMax 的凭据引用名（不是密钥本身） |
| `endpoint` | `https://www.minimaxi.com/v1/token_plan/remains` | MiniMax 接口 |
| `deepseekApiKeyEnv` | `DEEPSEEK_API_KEY` | DeepSeek 凭据引用名 |
| `deepseekEndpoint` | `https://api.deepseek.com/user/balance` | DeepSeek 接口 |
| `opencodeApiKeyEnv` | `OPENCODE_GO_API_KEY` | OpenCode Go 凭据引用名 |
| `opencodeEndpoint` | `https://opencode.ai/zen/go/v1/usage` | OpenCode Go 接口 |
| `timeoutMs` | `8000` | 单次上游请求超时 |
| `cacheMs` | `60000` | 成功响应复用时长，最大 600000 |
| `warmOnStart` | `true` | 启动后预热三条路由 |
| `models` | `['general']` | MiniMax 额度桶过滤；`[]` 显示全部 |

## 注意事项

- **密钥不出 Host**：只在 `index.js` 里解析和使用，不下发到页面，也不做缓存。
- **改 `index.js` 必须重启 `dsh web`**。它是 Host 进程早已 import 的 ES 模块，开关插件或重新 `install_bundle` 都不会让它重新加载（HMR 忽略 `**/node_modules`，且只监听 dsh 安装目录）。改 `client.js` 则刷新页面即可。
- **视频额度默认不显示**：MiniMax 会返回 `general` 和 `video` 两个桶，默认 `models: ['general']` 在 Host 侧就过滤掉，视频桶根本不会进入给浏览器的报文。要看得改成 `[]` 或 `['video']`，同样需要重启。
- **从 GitHub 安装不会自动跟随上游更新**：那是克隆进 profile 的 `node_modules`，升级要 `remove_bundle` 再 `install_bundle`。
- **药丸到不了输入框右边缘**，这是宿主结构决定的：dock 的父容器是 `align-items:center` 的列 flex，dock 自身没有 `width`，整行收缩到内容宽度并居中，所以 `margin-left:auto`、`flex:1` 这类在槽位内都不起作用。真要贴右边缘只能换到 `conversation.input.right`。
- **详情面板是 `position: fixed` 浮层**，锚定药丸、上方空间不足翻到下方、夹在视口内，所以展开收起不会顶动输入框。
- **OpenCode Go 的 usage 接口没有公开文档**：字段若变动会落到 `upstream-error`，面板里显示原因，药丸不会崩。

## 验证

```
npm test        # 等价于 node --test verify/host.test.mjs verify/client.test.mjs
```

- `verify/host.test.mjs`：用假 composition、假 `ServerResponse` 和桩 `fetch` 驱动真实 Host 半边——路由注册、OpenCode 窗口归一化、缺失窗口不补 0、`not-configured` 与上游失败映射、缓存与 `?refresh=1` 绕过、信任围栏与方法守卫。
- `verify/client.test.mjs`：把真实 `client.js` 放进假 `window`、最小 React hook 运行时和桩 `fetch` 里跑，覆盖四种 provider 的路由与渲染、失败与传输异常、MiniMax 剩余量换算、无关 provider 不渲染。
- `verify/live-opencode.mjs`：手动对真实网关跑一次 OpenCode 路由（读 `~/.dsh/.credentials.yaml`，只打印归一化结果）。怀疑字段变动时先跑它。

两个测试都不画像素，页面上的实际位置和颜色仍需在浏览器里看一眼。

## 许可证

MIT，全文见 [LICENSE](LICENSE)。Copyright (c) 2026 x7user。
