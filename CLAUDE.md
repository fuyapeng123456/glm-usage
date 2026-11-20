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

## 约定

- **缓存穿透**：`index.html` 以 `style.css?v=5`、`app.js?v=4` 引用资源，修改这两个文件后要递增 `?v=` 数字
- **XSS 防护**：任何用户可控字符串进 `innerHTML` 前必须过 `escapeHtml`；Key 的展示一律走 `maskKey()`
- **零依赖**：不引入外部库、CDN、图标字体；图标用内联 SVG（如微信双气泡 logo）
- **剪贴板**：统一走现成的 `copyPlain()`（含非 secure-context 的 textarea `execCommand` 降级），不要另写复制逻辑
- **提交信息**：conventional 前缀（`feat:` / `fix:` / `docs:`）+ 中文描述
