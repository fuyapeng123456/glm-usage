# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

GLM Coding Plan 用量查询面板：纯静态网页（无后端、无构建、无依赖），浏览器直连智谱官方接口查询用量，API Key 只存 localStorage。UI 文案全部为简体中文。

## 运行方式

没有 build / lint / test 工具链，改完代码直接在浏览器里验证：

```bash
python -m http.server 8000
# 桌面版 http://localhost:8000/   手机版 http://localhost:8000/h5.html
```

也可以直接双击 `index.html` / `h5.html`（`file://` 下复制等功能有降级路径，用本地服务器验证更接近线上行为）。

## 架构：两套并行实现，改动必须同步

这是本项目最重要的一点——桌面版和手机版是**各自独立、手工保持一致**的两份代码：

| | 文件 | 结构 |
|---|---|---|
| 桌面版 | `index.html` + `style.css` + `app.js` | 外链 CSS/JS |
| 手机版 | `h5.html` | **单文件自包含**（`<style>` 与 `<script>` 全部内联）|

`h5.html` 内联的 JS 是 `app.js` 逻辑的复制品（存储、添加/删除/复制、`refreshUsage`、`renderUsage`、`describeLimit` 等一一对应），内联 CSS 是 `style.css` 的手机版式翻写。**任何逻辑修复或接口适配都要在两处同时改**，包括：

- `API_URL`（若改走 Nginx 反代 `"/api/quota/"`，两处都要改，见 README）
- localStorage 的 key 格式、配额解析、渲染排序
- 交互行为差异仅限 UI 形态：桌面版 Key 用左侧列表 + 图标按钮，H5 用横向滚动 chips + 选中后操作行；重复 Key 提示桌面版用 `alert`、H5 用 `showToast`

### 数据与接口

- 两版共用同一份 localStorage（同域互通）：`glm_api_keys`（`[{id, alias, key, addedAt}]`）、`glm_selected`（选中 id）
- 接口：`GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`，请求头 `Authorization: <原始 key 明文>` 和 `Accept-Language: en-US,en`；响应 `{success, msg, data: {level, limits[]}}`
- 配额条目分类在 `describeLimit()`：`unit===3 && number===5` → 5 小时窗口，`unit===6` → 每周窗口；`type` 为 `TOKENS_LIMIT` / `CREDIT_LIMIT` / `TIME_LIMIT`（MCP 调用量）。渲染顺序固定：5h → week → credit → mcp（`renderUsage` 里的 `order` 映射）

## 坑：README 截图更新后 GitHub 显示旧图（Camo CDN 缓存）

README 里的图片经 `camo.githubusercontent.com` 代理，**按 URL 缓存**：同路径
文件更新后，CDN 可能继续返回旧图长达 1 小时左右，刷新仓库页面无效（即使
raw.githubusercontent.com 直连已是新图，浏览器怎么刷新都没用）。

**口径**：更新 `screenshots/` 下的截图必须**换新文件名**（如 `pc-v2.png` →
`pc-v3.png`）并同步修改 README 引用，禁止原地覆盖同名图片。文件是否真的
更新成功，可用 `git ls-tree <提交> <文件>` 对比 blob 哈希、或 curl raw 地址
的 Content-Length 验证——都正常而页面仍旧图，就是 Camo 缓存，等它过期即可。

## 坑 1：整个项目依赖接口对任意源放行 CORS（file:// 和线上部署都是）

「无后端、浏览器直连」的根基是智谱接口对任意 Origin 回显
`Access-Control-Allow-Origin`（含 `Origin: null` 的 file:// 空源，已实测放行）。
这意味着**线上部署和本地双击打开依赖的是同一行为**：官方一旦收紧 CORS
（只放行自家域名），所有用户的部署一起失效。

**口径**：失效特征是页面统一报「网络请求失败」。排查先 curl 带自己域名 /
`Origin: null` 测预检+实际请求，确认是 CORS 问题后再按 README 的 Nginx
反代方案改（`app.js` 与 `h5.html` 的 `API_URL` 两处都要改）。

## 坑 2：智谱接口的配额结构可能继续演进（分类魔法数字是实测反推的）

- 窗口分类 `unit===3 && number===5` → 5 小时窗口、`unit===6` → 每周窗口，
  是从实测响应反推的。官方若新增形态（如月度窗口），旧代码走「未知类型」
  兜底：显示原始 `type` 字符串、按 week 排序、当百分比渲染——**不报错但
  展示不对**，只能靠用户反馈发现
- 2026-11 已发生过一次：新版积分套餐是当时未知的 `CREDIT_LIMIT` 类型，
  单位被显示成「次」（数字对、单位错）
- **口径**：接到此类反馈，先 `curl` 带真实 Key 看原始 JSON 确认结构，再
  同步更新 `describeLimit()` 和 `renderUsage()` 的分类/渲染分支（两处都要
  改）。渲染分两类：有 `usage/currentValue` 字段的（积分/次数）展示
  「已用/总额」，否则展示 `percentage` 百分比；`nextResetTime` 为毫秒时间戳

## 约定

- **缓存穿透**：`index.html` 以 `style.css?v=5`、`app.js?v=4` 引用资源，修改这两个文件后要递增 `?v=` 数字
- **XSS 防护**：任何用户可控字符串进 `innerHTML` 前必须过 `escapeHtml`；Key 的展示一律走 `maskKey()`
- **零依赖**：不引入外部库、CDN、图标字体；图标用内联 SVG（如微信双气泡 logo）
- **剪贴板**：统一走现成的 `copyPlain()`（含非 secure-context 的 textarea `execCommand` 降级），不要另写复制逻辑
- **提交信息**：conventional 前缀（`feat:` / `fix:` / `docs:`）+ 中文描述
- **Key 粘贴去引号**：`addKey()` 会剥掉 Key 首尾引号和空白——用户从其他地方复制
  Key 常带引号，曾因此 401（服务器端还可能因 header 非 ASCII 直接 500）。勿删
- **调试纪律**：排查问题时禁止 `localStorage.clear()`（会清掉用户真实 Key）；
  测试数据用页面删除流程清理，或只删自己添加的条目
- **语法水位**：代码含 ES2020 语法（`??`，如 `currentValue ?? "?"`——0 是合法值，
  语义上必需，勿随手改成 `||`）；极老旧内核（老版微信 X5）可能因此白屏，属已知
  取舍，如需兼容极旧设备再引入构建工具
- **截图**：README 截图来自本地 127.0.0.1:8765（仓库根起 `python -m http.server`），
  PC 用 1280×720、H5 用 390×844 视口；截图前确认线上版本特性都已同步到本地代码
