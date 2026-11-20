/* GLM 用量监控 —— 纯前端实现
 * 数据直连智谱官方接口（接口已开放 CORS）：
 *   GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
 * API Key 仅存于浏览器 localStorage，不经任何中间服务器。
 */

"use strict";

const API_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";
const LS_KEYS = "glm_api_keys";      // [{id, alias, key, addedAt}]
const LS_SELECTED = "glm_selected";  // 当前选中 key 的 id

/* ---------- 存储 ---------- */
function loadKeys() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS)) || []; }
  catch { return []; }
}
function saveKeys(keys) {
  localStorage.setItem(LS_KEYS, JSON.stringify(keys));
}
function getSelectedId() {
  return localStorage.getItem(LS_SELECTED);
}
function setSelectedId(id) {
  if (id) localStorage.setItem(LS_SELECTED, id);
  else localStorage.removeItem(LS_SELECTED);
}

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function maskKey(key) {
  if (key.length <= 12) return key.slice(0, 3) + "****";
  return key.slice(0, 8) + "****" + key.slice(-4);
}

function fmtTime(ms) {
  const d = new Date(Number(ms));
  return isNaN(d) ? "未知" : d.toLocaleString("zh-CN", { hour12: false });
}

/** 距离时间戳的相对描述，如 "13 小时后"、"3 天后" */
function relTime(ms) {
  const diff = Number(ms) - Date.now();
  if (isNaN(diff) || diff <= 0) return "已重置";
  const h = diff / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(diff / 60e3))} 分钟后`;
  if (h < 48) return `${Math.round(h)} 小时后`;
  return `${Math.round(h / 24)} 天后`;
}

function barClass(pct) {
  if (pct >= 85) return "danger";
  if (pct >= 60) return "warn";
  return "";
}

/** 识别限额条目类型：5 小时窗口 / 每周窗口 / MCP 调用量 / 积分 */
function describeLimit(item) {
  // unit=3, number=5 → 5 小时窗口；unit=6 → 每周窗口
  const winSuffix = (item.unit === 3 && item.number === 5) ? "（5 小时窗口）"
    : item.unit === 6 ? "（每周窗口）" : "";
  if (item.type === "TIME_LIMIT") return "MCP 工具调用量";
  if (item.type === "TOKENS_LIMIT") return "Token 用量" + winSuffix;
  if (item.type === "CREDIT_LIMIT") return "积分用量" + winSuffix;
  return item.type || "未知配额";
}

/* ---------- Key 列表渲染 ---------- */
function renderKeys() {
  const keys = loadKeys();
  const list = $("#key-list");
  const selectedId = getSelectedId();
  list.innerHTML = "";
  $("#keys-empty").classList.toggle("hidden", keys.length > 0);

  for (const item of keys) {
    const li = document.createElement("li");
    li.className = "key-item" + (item.id === selectedId ? " active" : "");
    li.innerHTML = `
      <span class="dot"></span>
      <div class="key-info">
        <div class="alias">${escapeHtml(item.alias || "未命名 Key")}</div>
        <div class="masked">${escapeHtml(maskKey(item.key))}</div>
      </div>
      <button class="btn btn-icon" type="button" title="复制完整 Key" data-copy="${item.id}">⧉</button>
      <button class="btn btn-icon" type="button" title="删除" data-del="${item.id}">✕</button>`;
    li.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]") || e.target.closest("[data-copy]")) return;
      selectKey(item.id);
    });
    list.appendChild(li);
  }

  $("#btn-refresh").disabled = !getSelectedId();
}

/* ---------- 添加 / 删除 / 选择 ---------- */
function addKey(alias, rawKey) {
  // 去掉粘贴时可能带上的首尾引号和空白
  const key = rawKey.trim().replace(/^["']+|["']+$/g, "").trim();
  const keys = loadKeys();
  const dup = keys.find((k) => k.key === key);
  if (dup) {
    alert("这个 Key 已经存在（备注：" + (dup.alias || "未命名") + "）");
    return;
  }
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    alias: alias.trim(),
    key,
    addedAt: Date.now(),
  };
  keys.push(item);
  saveKeys(keys);
  setSelectedId(item.id);
  renderKeys();
  refreshUsage();
}

/* ---------- 删除（二次确认弹框）/ 复制 ---------- */
let pendingDeleteId = null;
let toastTimer = null;

function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

function openDeleteModal(id) {
  const item = loadKeys().find((k) => k.id === id);
  if (!item) return;
  pendingDeleteId = id;
  $("#modal-text").textContent =
    `确定删除「${item.alias || "未命名 Key"}」（${maskKey(item.key)}）吗？删除后如需继续使用要重新添加。`;
  $("#modal-overlay").classList.remove("hidden");
}

function closeDeleteModal() {
  pendingDeleteId = null;
  $("#modal-overlay").classList.add("hidden");
}

function deleteKey(id) {
  const keys = loadKeys();
  if (!keys.some((k) => k.id === id)) return;
  saveKeys(keys.filter((k) => k.id !== id));
  if (getSelectedId() === id) {
    setSelectedId(null);
    showEmptyState();
  }
  renderKeys();
  showToast("已删除");
}

async function copyKey(id) {
  const item = loadKeys().find((k) => k.id === id);
  if (!item) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(item.key);
    } else {
      // 非 https 环境的降级复制
      const ta = document.createElement("textarea");
      ta.value = item.key;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    showToast("已复制完整 API Key 到剪贴板");
  } catch (e) {
    showToast("复制失败，请手动复制");
  }
}

function selectKey(id) {
  setSelectedId(id);
  renderKeys();
  refreshUsage();
}

/* ---------- 用量查询 ---------- */
async function refreshUsage() {
  const id = getSelectedId();
  const item = loadKeys().find((k) => k.id === id);
  if (!item) return;

  showLoadingState(item);
  try {
    const resp = await fetch(API_URL, {
      headers: {
        "Authorization": item.key,
        "Accept-Language": "en-US,en",
      },
    });
    if (resp.status === 401) throw new Error("认证失败：API Key 无效或已过期");
    if (!resp.ok) throw new Error("接口返回 HTTP " + resp.status);
    const payload = await resp.json();
    if (!payload.success) throw new Error(payload.msg || "接口返回 success=false");
    renderUsage(payload.data || {});
  } catch (err) {
    const msg = err instanceof TypeError
      ? "网络请求失败（请检查本机能否访问 open.bigmodel.cn）"
      : err.message;
    showErrorState(msg);
  }
}

function showEmptyState() {
  $("#usage-title").textContent = "用量信息";
  $("#usage-body").innerHTML = `
    <div class="state state-empty">
      <div class="state-icon">📊</div>
      <p>在左侧选择一个 API Key 查看用量</p>
    </div>`;
  $("#last-updated").textContent = "";
}

function showLoadingState(item) {
  $("#usage-title").textContent = "用量信息 · " + (item.alias || maskKey(item.key));
  $("#usage-body").innerHTML = `
    <div class="state">
      <div class="spin"></div>
      <p>正在查询 <code>${escapeHtml(maskKey(item.key))}</code> …</p>
    </div>`;
}

function showErrorState(msg) {
  $("#usage-body").innerHTML = `
    <div class="state state-error">
      <div class="state-icon">⚠️</div>
      <p><b>查询失败</b><br>${escapeHtml(msg)}</p>
    </div>`;
  $("#last-updated").textContent = "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function renderUsage(data) {
  const level = String(data.level || "未知").toUpperCase();
  const limits = data.limits || [];

  /* 顺序固定：5 小时窗口 → 每周窗口 → 积分 → MCP */
  const order = { "5h": 0, week: 1, credit: 2, mcp: 3 };
  const parsed = limits.map((item) => {
    const label = describeLimit(item);
    const kind = item.type === "TIME_LIMIT" ? "mcp"
      : item.type === "CREDIT_LIMIT" ? "credit"
      : label.includes("5 小时") ? "5h" : "week";
    return { ...item, label, kind };
  }).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));

  const cards = parsed.map((item) => {
    const pct = Number(item.percentage) || 0;
    let valueHtml;
    if (item.kind === "mcp") {
      valueHtml = `${item.currentValue ?? "?"} <small>/ ${item.usage ?? "?"} 次</small>`;
    } else if (item.kind === "credit") {
      valueHtml = `
        <span class="quota-pct">${pct}<small>%</small></span>
        <span class="quota-amount">${item.currentValue ?? "?"} / ${item.usage ?? "?"} 积分</span>`;
    } else {
      valueHtml = `${pct}<small>%</small>`;
    }
    const details = (item.usageDetails || [])
      .map((d) => `<div>- <b>${escapeHtml(d.modelCode)}</b>：${d.usage} 次</div>`)
      .join("");
    // 次数/积分类配额接口会下发 remaining，展示剩余量
    const unitWord = item.kind === "mcp" ? "次" : item.kind === "credit" ? "积分" : "";
    const remainingHtml = (unitWord && item.remaining != null)
      ? `<div>剩余：<b>${item.remaining}</b> ${unitWord}</div>` : "";

    return `
      <div class="quota-card">
        <h3>${escapeHtml(item.label)}</h3>
        <div class="quota-value${item.kind === "credit" ? " quota-row" : ""}">${valueHtml}</div>
        <div class="bar"><div class="bar-fill ${barClass(pct)}" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>
        <div class="quota-meta">
          ${remainingHtml}
          <div>重置时间：<b>${fmtTime(item.nextResetTime)}</b>（${relTime(item.nextResetTime)}）</div>
        </div>
        ${details ? `<div class="mcp-details">${details}</div>` : ""}
      </div>`;
  }).join("");

  $("#usage-title").textContent = "用量信息";
  $("#usage-body").innerHTML = `
    <span class="plan-badge">${escapeHtml(level)} 套餐</span>
    <div class="usage-cards">${cards || '<div class="state">接口未返回任何配额数据</div>'}</div>`;
  $("#last-updated").textContent = "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  const form = $("#add-form");

  $("#btn-toggle-add").addEventListener("click", () => {
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) $("#add-key").focus();
  });

  $("#add-show").addEventListener("change", (e) => {
    $("#add-key").type = e.target.checked ? "text" : "password";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = $("#add-key").value.trim();
    if (!key || !/^[\x21-\x7e]+$/.test(key)) {
      alert("请输入有效的 API Key（不含空格的英文数字串）");
      return;
    }
    addKey($("#add-alias").value, key);
    form.reset();
    $("#add-key").type = "password";
    $("#add-show").checked = false;
    form.classList.add("hidden");
  });

  $("#key-list").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { openDeleteModal(del.dataset.del); return; }
    const copy = e.target.closest("[data-copy]");
    if (copy) copyKey(copy.dataset.copy);
  });

  // 删除二次确认弹框
  $("#modal-confirm").addEventListener("click", () => {
    const id = pendingDeleteId;
    closeDeleteModal();
    if (id) deleteKey(id);
  });
  $("#modal-cancel").addEventListener("click", closeDeleteModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target === $("#modal-overlay")) closeDeleteModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal-overlay").classList.contains("hidden")) {
      closeDeleteModal();
    }
  });

  $("#btn-refresh").addEventListener("click", refreshUsage);
}

/* ---------- 启动 ---------- */
bindEvents();
renderKeys();
if (getSelectedId()) refreshUsage();
else showEmptyState();
