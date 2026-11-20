// ==UserScript==
// @name         微信读书·微信模式
// @namespace    weread-wechat-mode
// @version      0.7.0
// @description  M5：微信读书 PDF / EPUB 阅读器 + Grafana 真实日志 + IDE 工作目录伪装。
// @author       weread-wechat-mode
// @license      MIT
// @match        https://weread.qq.com/*
// @require      https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
// @require      https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @connect      igfa.dcgstd.cn
// @noframes
// ==/UserScript==

/*
 * M5 范围：
 *   - 只在 /web/reader/* 接管；PDF 与文字 EPUB 两种适配器
 *   - PDF：检测 pdfUrl / fm=pdf / /cos/download / PDF DOM，PDF.js 自绘页面
 *   - EPUB：挂住官方阅读器的 /web/book/chapter/e_N 响应，解码 base64 后渲染成白色文档
 *   - EPUB 章节目录读取官方 .readerCatalog_list_item，点击目录项驱动官方阅读器加载章节
 *   - 左栏：本地记录过的书 + 书架接口里能确认的 PDF / EPUB 书
 *   - 点左栏“微信读书”切换“工作目录”伪装：文件树、分支下拉、工作文档名、标签页标题
 *   - 右栏：微信式文件消息卡片，PDF/EPUB 都打开同类阅读器
 *   - 右侧固定“运行日志”栏，优先 Grafana 真实日志，失败回退模拟；支持只看日志
 *   - 不做：气泡聊天、划线/想法/评论、字号缩放、暗黑模式
 *
 * 隐私：
 *   - PDF 字节通过 GM_xmlhttpRequest 下载（@connect *），只请求脚本解析出的签名地址
 *   - EPUB 章节响应由页面自己发起并签名，本脚本只读响应、解码、缓存，不伪造请求
 *   - 真实日志查询发往 igfa.dcgstd.cn（使用浏览器里的 Grafana 登录态），查询语句固定
 *   - 模拟日志与工作目录为本地生成；所有内容只显示在本地，不上传
 *   - 不记录 Cookie，不上传统计数据
 *
 * 已知风险：
 *   - 签名 PDF 地址可能过期，预览前会重新获取
 *   - PDF 需要整份下载后才能预览，大文件首次打开较慢
 *   - PDF.js 与 pdf.worker 通过 CDN @require；优先主线程 worker，失败再逐级回退
 *   - EPUB 依赖官方阅读器 DOM（目录、正文容器）与章节分片格式；站点改版可能失效
 *   - EPUB 翻章会驱动官方阅读器，可能改变官方阅读进度
 *   - 书架接口字段未知，格式过滤有兜底；当前书始终会出现在左栏
 */

(() => {
  "use strict";

  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  if (W.__WR_CHAT_MODE_INSTALLED__) return;
  W.__WR_CHAT_MODE_INSTALLED__ = true;

  const VERSION = "0.7.0";
  const LOG_PREFIX = "[微信读书·微信模式]";
  const HOST_ID = "wr-chat-host";
  const MIN_WIDTH = 1000;
  const DETECT_TIMEOUT = 20000;
  const PDFJS_VER = "3.11.174";
  const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/`;
  const PDFJS_WORKER = `${PDFJS_BASE}build/pdf.worker.min.js`;
  const DEFAULT_ZOOM = 1;
  const REAL_LOGS = {
    base: "https://igfa.dcgstd.cn/grafana",
    datasourceUid: "d326ce70-ce9c-4255-bd69-5f349126c588",
    orgId: 1,
    query: '{job="ttigd-manage-web"}',
    lookbackSec: 3600,
    limit: 300,
    refreshMs: 5000,
    retryMs: 30000,
  };

  const STORE = {
    enabled: "wrChatEnabled",
    books: "wrChatPdfBooks",
    workMode: "wrChatWorkMode",
    leftWidth: "wrChatLeftWidth",
    logWidth: "wrChatLogWidth",
    logsOnly: "wrChatLogsOnly",
    grafanaToken: "wrChatGrafanaToken",
  };

  let resizeBound = false;

  const state = {
    enabled: storeGet(STORE.enabled, true) !== false,
    startedAt: Date.now(),
    bootToken: 0,
    ctx: null,
    ui: null,
    shelf: [],
    shelfLoading: false,
    shelfLoaded: false,
    previewOpen: false,
    previewUrl: "",
    previewToken: 0,
    viewer: null,
    epubChunks: new Map(),
    epubLastKey: "",
    epubLastAt: 0,
    workMode: storeGet(STORE.workMode, false) === true,
    workSelected: "",
    workBranch: "main",
    workCollapsed: false,
    branchMenuOpen: false,
    workExpanded: new Set([
      "src",
      "src/main",
      "src/main/java",
      "src/main/java/com",
      "src/main/java/com/ttigd",
      "src/main/java/com/ttigd/manage",
      "src/main/java/com/ttigd/manage/controller",
      "src/main/resources",
      "scripts",
    ]),
    originalTitle: "",
    originalFavicons: null,
    createdFavicon: null,
    leftWidth: clamp(Number(storeGet(STORE.leftWidth, 280)) || 280, 220, 460),
    logWidth: clamp(Number(storeGet(STORE.logWidth, 340)) || 340, 220, 1800),
    logsOnly: storeGet(STORE.logsOnly, false) === true,
    chatLogTimer: null,
  };

  const signals = {
    cbBookId: null,
    cosBookId: null,
    cosUrl: "",
    cosUrlBookId: null,
    cosAt: 0,
    fmPdf: false,
    fmPdfInfoId: null,
    sawCos: false,
  };

  /* ============================== 工具 ============================== */

  const log = (...args) => console.log(LOG_PREFIX, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, ...args);

  function storeGet(key, fallback) {
    try {
      if (typeof GM_getValue !== "function") return fallback;
      const v = GM_getValue(key);
      return v === undefined || v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function storeSet(key, value) {
    try {
      if (typeof GM_setValue === "function") GM_setValue(key, value);
    } catch (e) {
      warn("存储失败", key, e);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const escapeAttr = escapeHtml;

  function toMs(ts) {
    const n = Number(ts);
    if (!isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? n * 1000 : n;
  }

  function timeAgo(ts) {
    const ms = toMs(ts);
    if (!ms) return "";
    const diff = Date.now() - ms;
    if (diff < 60 * 1000) return "刚刚";
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 48 * 3600 * 1000) return "昨天";
    const d = new Date(ms);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function clamp(n, min, max) {
    const v = Number(n);
    return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  }

  function bindHorizontalDrag(handle, opts) {
    if (!handle) return;
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const startX = ev.clientX;
      const startW = Number(opts.getWidth()) || 0;
      const min = typeof opts.min === "function" ? opts.min() : opts.min;
      const max = typeof opts.max === "function" ? opts.max() : opts.max;
      const prevCursor = document.documentElement.style.cursor;
      const prevSelect = document.documentElement.style.userSelect;
      handle.classList.add("dragging");
      document.documentElement.style.cursor = "col-resize";
      document.documentElement.style.userSelect = "none";
      const move = (e) => {
        const delta = (e.clientX - startX) * (opts.invert ? -1 : 1);
        opts.onMove(clamp(startW + delta, min, max));
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        handle.classList.remove("dragging");
        document.documentElement.style.cursor = prevCursor;
        document.documentElement.style.userSelect = prevSelect;
        if (opts.onEnd) opts.onEnd();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
      opts.onMove(clamp(startW, min, max));
    });
  }

  function applyLeftWidth(w) {
    state.leftWidth = clamp(w, 220, 460);
    const ui = state.ui;
    if (!ui || !ui.side) return;
    ui.side.style.width = `${state.leftWidth}px`;
    ui.side.style.flexBasis = `${state.leftWidth}px`;
  }

  function isReaderPage() {
    return /^\/web\/reader\//.test(location.pathname);
  }

  function pathInfoId() {
    try {
      const m = location.pathname.match(/\/web\/reader\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) {
      return "";
    }
  }

  function readerInfoBase(id) {
    const s = String(id || "");
    const i = s.indexOf("k");
    return i > 0 ? s.slice(0, i) : s;
  }

  function docTitle() {
    const t = String(document.title || "")
      .replace(/\s*-\s*微信读书\s*$/, "")
      .trim();
    return t && t !== "微信读书" ? t : "";
  }

  function readerState() {
    try {
      const s = W.__INITIAL_STATE__;
      return s && s.reader ? s.reader : null;
    } catch (e) {
      return null;
    }
  }

  // 阅读页 infoId 里可解出导入书 bookId，例如 ... => CB_6DR0M50OA0vl77l75iAQjBlh
  function cbIdFromInfoId(infoId) {
    const s = String(infoId || "");
    if (!s) return "";
    let best = "";
    for (let start = 0; start < s.length; start++) {
      let out = "";
      for (let i = start; i + 1 < s.length; i += 2) {
        const v = parseInt(s.slice(i, i + 2), 16);
        if (Number.isNaN(v) || v < 0x20 || v >= 0x7f) break;
        out += String.fromCharCode(v);
      }
      if (out.length > best.length && /^[A-Za-z0-9]+$/.test(out)) best = out;
    }
    return best.length >= 10 ? `CB_${best}` : "";
  }

  /* ============================== 微信读书请求信号 ============================== */

  function installSignalHooks() {
    const origFetch = W.fetch;
    if (typeof origFetch === "function") {
      try {
        W.fetch = function (input, init) {
          let url = "";
          try {
            url = typeof input === "string" ? input : input && input.url ? input.url : "";
            inspectRequest(url, init && init.body);
          } catch (e) {
            /* ignore */
          }
          const promise = origFetch.apply(this, arguments);
          if (url) {
            try {
              promise.then(
                (resp) => {
                  try {
                    inspectResponse(url, resp);
                  } catch (e) {
                    /* ignore */
                  }
                  if (EPUB_CHUNK_RE.test(url)) {
                    try {
                      const reqBody = init && typeof init.body === "string" ? init.body : "";
                      resp
                        .clone()
                        .text()
                        .then((text) => ingestChapterChunk(url, reqBody, text))
                        .catch(() => {});
                    } catch (e) {
                      /* ignore */
                    }
                  }
                },
                () => {},
              );
            } catch (e) {
              /* ignore */
            }
          }
          return promise;
        };
      } catch (e) {
        warn("fetch 钩子安装失败", e);
      }
    }

    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      try {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
          try {
            this.__wrChatUrl = String(url);
          } catch (e) {
            /* ignore */
          }
          return origOpen.apply(this, arguments);
        };
        XHR.prototype.send = function (body) {
          try {
            const url = this.__wrChatUrl || "";
            inspectRequest(url, body);
            if (url && url.includes("/cos/download")) {
              const xhr = this;
              xhr.addEventListener(
                "loadend",
                () => {
                  try {
                    const rt = xhr.responseType || "";
                    let txt = "";
                    if (rt === "" || rt === "text") txt = xhr.responseText;
                    else if (rt === "json" && xhr.response) txt = JSON.stringify(xhr.response);
                    if (txt) parseCosPayload(txt, url);
                  } catch (e) {
                    /* ignore */
                  }
                },
                { once: true },
              );
            }
            if (url && EPUB_CHUNK_RE.test(url)) {
              const xhr = this;
              const reqBody = typeof body === "string" ? body : "";
              xhr.addEventListener(
                "loadend",
                () => {
                  try {
                    const rt = xhr.responseType || "";
                    if (rt === "" || rt === "text") ingestChapterChunk(url, reqBody, xhr.responseText);
                  } catch (e) {
                    /* ignore */
                  }
                },
                { once: true },
              );
            }
          } catch (e) {
            /* ignore */
          }
          return origSend.apply(this, arguments);
        };
      } catch (e) {
        warn("XHR 钩子安装失败", e);
      }
    }
  }

  function inspectRequest(url, body) {
    if (!url) return;
    if (url.includes("/cos/download")) {
      signals.sawCos = true;
      try {
        const u = new URL(url, location.href);
        const bookId = u.searchParams.get("bookId");
        if (bookId) {
          signals.cbBookId = bookId;
          signals.cosBookId = bookId;
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (typeof body === "string" && body.length < 8192 && /"fm"\s*:\s*"pdf"/.test(body)) {
      signals.fmPdf = true;
      const m = body.match(/"b"\s*:\s*"([^"]+)"/);
      if (m && m[1]) signals.fmPdfInfoId = m[1];
    }
  }

  function inspectResponse(url, resp) {
    if (!url.includes("/cos/download")) return;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("json")) return;
    try {
      resp
        .clone()
        .text()
        .then((txt) => parseCosPayload(txt, url))
        .catch(() => {});
    } catch (e) {
      /* ignore */
    }
  }

  function parseCosPayload(txt, requestUrl) {
    if (!txt) return;
    try {
      const j = JSON.parse(txt);
      const url = j && (j.url || (j.data && j.data.url));
      if (!url) return;
      let bookId = signals.cosBookId;
      try {
        bookId = new URL(requestUrl, location.href).searchParams.get("bookId") || bookId;
      } catch (e) {
        /* ignore */
      }
      signals.cosUrl = url;
      signals.cosUrlBookId = bookId || null;
      signals.cosAt = Date.now();
      signals.sawCos = true;
    } catch (e) {
      /* ignore */
    }
  }

  /* ============================== EPUB 章节分片 ============================== */

  const EPUB_CHUNK_RE = /\/web\/book\/chapter\/e_(\d+)/;

  function decodeChapterChunk(raw) {
    const str = String(raw || "").trim();
    if (!str || str.length < 40) return "";
    for (const off of [33, 32]) {
      try {
        const b64 = str.slice(off);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64.slice(0, 120))) continue;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const out = new TextDecoder("utf-8").decode(bytes);
        if (out && !out.includes("�")) return out;
      } catch (e) {
        /* try next */
      }
    }
    return "";
  }

  function ingestChapterChunk(url, bodyText, responseText) {
    try {
      const m = String(url || "").match(EPUB_CHUNK_RE);
      if (!m || !responseText) return;
      const idx = Number(m[1]);
      let body = null;
      try {
        body = typeof bodyText === "string" ? JSON.parse(bodyText) : bodyText;
      } catch (e) {
        body = null;
      }
      const c = body && typeof body.c === "string" ? body.c : "";
      if (!c) return;
      const isStyle = Number(body.st) === 1;
      const text = decodeChapterChunk(responseText);
      if (!text) return;
      let set = state.epubChunks.get(c);
      if (!set) {
        set = { html: new Map(), css: new Map(), at: 0 };
        state.epubChunks.set(c, set);
      }
      if (isStyle) set.css.set(idx, text);
      else set.html.set(idx, text);
      set.at = Date.now();
      state.epubLastKey = c;
      state.epubLastAt = Date.now();
      if (typeof state.epubNotify === "function") {
        try {
          state.epubNotify();
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function chapterHtmlFor(c) {
    const set = state.epubChunks.get(c);
    if (!set || !set.html.size) return "";
    return [...set.html.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((item) => item[1])
      .join("");
  }

  function chapterCssFor(c) {
    const set = state.epubChunks.get(c);
    if (!set || !set.css.size) return "";
    return [...set.css.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((item) => item[1])
      .join("\n");
  }

  function chapterKeyForTitle(title) {
    const needle = String(title || "").trim();
    if (!needle) return "";
    for (const c of state.epubChunks.keys()) {
      const html = chapterHtmlFor(c);
      if (html && html.includes(needle)) return c;
    }
    return "";
  }

  /* ============================== PDF 检测 ============================== */

  function domLooksPdf() {
    const selectors = [
      'embed[type="application/pdf"]',
      'object[type="application/pdf"]',
      'iframe[src*=".pdf"]',
      'iframe[src*="gfp.tencent-cloud.com"]',
      '[class*="pdfviewer" i]',
      '[class*="pdf-viewer" i]',
      '[class*="readerpdf" i]',
      'canvas[class*="pdf" i]',
    ];
    for (const sel of selectors) {
      try {
        if (document.querySelector(sel)) return true;
      } catch (e) {
        /* ignore */
      }
    }
    return false;
  }

  function detectPdf() {
    if (!isReaderPage()) return null;

    const st = readerState();
    const bi = st && st.bookInfo ? st.bookInfo : null;
    const pdfUrl = st && typeof st.pdfUrl === "string" ? st.pdfUrl : "";
    const infoId = (st && st.infoId) || pathInfoId();
    const derivedCb = cbIdFromInfoId(infoId);
    const fmForThis = signals.fmPdf && (!signals.fmPdfInfoId || !infoId || signals.fmPdfInfoId === infoId);
    const cosForThis =
      signals.sawCos && (!derivedCb || !signals.cosBookId || signals.cosBookId === derivedCb);
    const isPdf = fmForThis || cosForThis || !!pdfUrl || domLooksPdf();
    if (!isPdf) return null;

    const title = (bi && bi.title) || docTitle();
    if (!title) return null;

    const cbBookId = derivedCb || signals.cbBookId || "";
    const bookId = (bi && bi.bookId) || "";
    return {
      key: cbBookId || bookId || infoId || title,
      title,
      author: (bi && bi.author) || "",
      cover: (bi && bi.cover) || "",
      bookId,
      infoId,
      cbBookId,
      readerUrl: location.href,
      pdfUrl,
      bookType: "pdf",
      lastReadAt: Date.now(),
    };
  }

  function detectEpub() {
    if (!isReaderPage()) return null;

    const st = readerState();
    const bi = st && st.bookInfo ? st.bookInfo : null;
    const infoId = (st && st.infoId) || pathInfoId();
    const derivedCb = cbIdFromInfoId(infoId);
    const pdfUrl = st && typeof st.pdfUrl === "string" ? st.pdfUrl : "";
    const fmForThis = signals.fmPdf && (!signals.fmPdfInfoId || !infoId || signals.fmPdfInfoId === infoId);
    const cosForThis =
      signals.sawCos && (!derivedCb || !signals.cosBookId || signals.cosBookId === derivedCb);
    if (fmForThis || cosForThis || pdfUrl || domLooksPdf()) return null;
    if (document.querySelector(".readerForbidden")) return null;
    if (bi && bi.isEPUBComics) return null;
    if (Date.now() - state.startedAt < 1500) return null;

    const tocItems = document.querySelectorAll(".readerCatalog_list_item");
    const content = document.querySelector(".readerChapterContent");
    const catalogMarker = document.querySelector(
      ".readerCatalog, .readerControls_item.catalog, .rbb_item.catalog",
    );
    if (!catalogMarker && !tocItems.length) return null;
    if (!tocItems.length && !content) return null;

    const format = String((bi && bi.format) || "").toLowerCase();
    if (format && format !== "epub" && !tocItems.length) return null;

    const domTitleEl = document.querySelector(".readerCatalog_bookInfo_title");
    const chapterTitleEl = document.querySelector(".readerTopBar_title_chapter");
    const title =
      (bi && bi.title) ||
      (domTitleEl && domTitleEl.textContent ? domTitleEl.textContent.trim() : "") ||
      (chapterTitleEl && chapterTitleEl.textContent ? chapterTitleEl.textContent.trim() : "") ||
      docTitle();
    if (!title) return null;

    const coverImg = document.querySelector(".readerCatalog_bookInfo_cover img");
    const bookId = (bi && bi.bookId) || "";
    return {
      key: derivedCb || bookId || infoId || title,
      title,
      author: (bi && bi.author) || "",
      cover: (bi && bi.cover) || (coverImg && coverImg.src) || "",
      bookId,
      infoId,
      cbBookId: derivedCb || signals.cbBookId || "",
      readerUrl: location.href,
      pdfUrl: "",
      bookType: "epub",
      lastReadAt: Date.now(),
    };
  }

  function detectBook() {
    return detectPdf() || detectEpub();
  }

  function waitForPdf(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const ctx = detectBook();
        if (ctx) {
          resolve(ctx);
          return;
        }
        if (!isReaderPage() || Date.now() - start >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 400);
      };
      tick();
    });
  }

  /* ============================== 本地书单 ============================== */

  function readCache() {
    const v = storeGet(STORE.books, {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  function rememberBook(ctx) {
    if (!ctx || !ctx.key) return;
    const cache = readCache();
    cache[ctx.key] = {
      key: ctx.key,
      title: ctx.title,
      author: ctx.author,
      cover: ctx.cover,
      bookId: ctx.bookId,
      infoId: ctx.infoId,
      cbBookId: ctx.cbBookId,
      readerUrl: ctx.readerUrl,
      bookType: ctx.bookType || "pdf",
      lastReadAt: normalizeTs(Date.now()),
    };
    const entries = Object.values(cache)
      .sort((a, b) => (toMs(b.lastReadAt) || 0) - (toMs(a.lastReadAt) || 0))
      .slice(0, 30);
    const next = {};
    for (const b of entries) next[b.key] = b;
    storeSet(STORE.books, next);
  }

  function normalizeTs(ts) {
    return toMs(ts);
  }

  function normalizeBook(b) {
    return {
      key: b.key || b.title,
      title: b.title || "未命名",
      author: b.author || "",
      cover: b.cover || "",
      bookId: b.bookId || "",
      infoId: b.infoId || "",
      cbBookId: b.cbBookId || "",
      readerUrl: b.readerUrl || "",
      bookType: b.bookType || "pdf",
      lastReadAt: toMs(b.lastReadAt),
      disabled: false,
      source: b.source || "",
    };
  }

  function mergedBooks() {
    const map = new Map();
    for (const b of Object.values(readCache())) {
      const nb = normalizeBook(b);
      if (nb.key) map.set(nb.key, nb);
    }
    for (const b of state.shelf) {
      if (!map.has(b.key)) map.set(b.key, b);
    }
    const ctx = state.ctx;
    if (ctx) {
      const prev = map.get(ctx.key) || {};
      map.set(ctx.key, normalizeBook({ ...prev, ...ctx, lastReadAt: Date.now() }));
    }
    const byTitle = new Map();
    for (const b of map.values()) {
      const sig = String(b.title || "").trim();
      const prev = byTitle.get(sig);
      if (!prev) {
        byTitle.set(sig, b);
        continue;
      }
      const bCurrent = ctx && b.key === ctx.key;
      const prevCurrent = ctx && prev.key === ctx.key;
      if (bCurrent && !prevCurrent) byTitle.set(sig, b);
      else if (bCurrent === prevCurrent && !prev.readerUrl && b.readerUrl) byTitle.set(sig, b);
    }

    const arr = Array.from(byTitle.values());
    arr.sort((a, b) => {
      const ac = ctx && a.key === ctx.key ? 1 : 0;
      const bc = ctx && b.key === ctx.key ? 1 : 0;
      return bc - ac || (b.lastReadAt || 0) - (a.lastReadAt || 0);
    });
    return arr;
  }

  /* ============================== 书架接口 ============================== */

  async function loadShelf(force) {
    if (state.shelfLoading) return;
    if (state.shelfLoaded && !force) return;
    state.shelfLoading = true;
    state.shelfLoaded = true;
    try {
      const fetchFn = typeof W.fetch === "function" ? W.fetch : window.fetch;
      const res = await fetchFn.call(W, "/web/shelf/sync?synckey=0&teenmode=0&aid=0", {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
      });
      if (!res || !res.ok) throw new Error(`shelf ${res && res.status}`);
      const j = await res.json();
      state.shelf = extractShelfBooks(j);
      log(`书架：共解析 ${state.shelf.length} 本可确认的书`);
      renderSidebar();
    } catch (e) {
      state.shelfLoaded = false;
      warn("书架接口不可用，仅使用本地记录", e && e.message ? e.message : e);
    } finally {
      state.shelfLoading = false;
    }
  }

  function extractShelfBooks(j) {
    const arr = Array.isArray(j && j.books)
      ? j.books
      : Array.isArray(j && j.bookList)
        ? j.bookList
        : Array.isArray(j && j.data && j.data.books)
          ? j.data.books
          : [];
    if (arr.length) {
      try {
        log("书架首条字段", Object.keys(arr[0]).join(","));
      } catch (e) {
        /* ignore */
      }
    }
    return arr
      .map((b, i) => {
        if (!b || typeof b !== "object") return null;
        const title = b.title || b.bookName || b.name || "";
        const bookId = String(b.bookId || b.bookID || "");
        const infoId = String(b.infoId || b.readerInfoId || "");
        let readerUrl = "";
        for (const candidate of [b.readerLink, b.deepLink]) {
          if (candidate && /\/web\/reader\//.test(String(candidate))) {
            readerUrl = String(candidate);
            break;
          }
        }
        if (!readerUrl && infoId) readerUrl = `https://weread.qq.com/web/reader/${infoId}`;
        const fmt = String(
          b.format ?? b.bookType ?? b.fileFormat ?? b.fileType ?? b.type ?? "",
        ).toLowerCase();
        const isPdf =
          b.isPdf === 1 ||
          b.pdf === 1 ||
          b.pdfType === 1 ||
          fmt.includes("pdf") ||
          /\.pdf(?:[?#]|$)/i.test(String(b.fileUrl || b.url || ""));
        const isEpub =
          !isPdf && !b.isEPUBComics && (fmt.includes("epub") || b.isEPUB === 1 || b.isEpub === 1);
        if ((!isPdf && !isEpub) || !title) return null;
        return {
          key: bookId || infoId || title || `shelf-${i}`,
          title,
          author: b.author || "",
          cover: b.cover || b.coverUrl || "",
          bookId,
          infoId,
          cbBookId: /^CB_/.test(bookId) ? bookId : "",
          readerUrl,
          bookType: isPdf ? "pdf" : "epub",
          lastReadAt: toMs(b.readUpdateTime ?? b.updateTime ?? b.lastReadTime ?? b.finishTime ?? 0),
          disabled: !readerUrl,
          source: "shelf",
        };
      })
      .filter(Boolean);
  }

  /* ============================== 工作目录伪装 ============================== */

  const WORK_DOC_NAME = "design-spec.pdf";
  const WORK_TREE = [
    {
      name: "src",
      type: "dir",
      children: [
        {
          name: "main",
          type: "dir",
          children: [
            {
              name: "java",
              type: "dir",
              children: [
                {
                  name: "com",
                  type: "dir",
                  children: [
                    {
                      name: "ttigd",
                      type: "dir",
                      children: [
                        {
                          name: "manage",
                          type: "dir",
                          children: [
                            {
                              name: "controller",
                              type: "dir",
                              children: [
                                { name: "OrderController.java", type: "file", status: "M" },
                                { name: "RefundController.java", type: "file" },
                              ],
                            },
                            {
                              name: "service",
                              type: "dir",
                              children: [
                                { name: "OrderService.java", type: "file", status: "M" },
                                { name: "InventoryService.java", type: "file" },
                              ],
                            },
                            {
                              name: "config",
                              type: "dir",
                              children: [{ name: "WebConfig.java", type: "file", status: "U" }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              name: "resources",
              type: "dir",
              children: [
                { name: "application.yml", type: "file" },
                { name: "mapper", type: "dir", children: [{ name: "OrderMapper.xml", type: "file" }] },
              ],
            },
          ],
        },
        {
          name: "test",
          type: "dir",
          children: [
            { name: "java", type: "dir", children: [{ name: "OrderServiceTest.java", type: "file" }] },
          ],
        },
      ],
    },
    {
      name: "scripts",
      type: "dir",
      children: [
        { name: "deploy.sh", type: "file" },
        { name: "migrate.sql", type: "file", status: "D" },
      ],
    },
    { name: "pom.xml", type: "file", status: "M" },
    { name: "README.md", type: "file" },
  ];

  const WORK_INDEX = new Map();
  (function indexWorkTree(nodes, base) {
    for (const node of nodes) {
      const path = base ? `${base}/${node.name}` : node.name;
      node.path = path;
      WORK_INDEX.set(path, node);
      if (node.children) indexWorkTree(node.children, path);
    }
  })(WORK_TREE, "");

  function workDocName() {
    if (state.workMode) return WORK_DOC_NAME;
    const ctx = state.ctx;
    const ext = ctx && ctx.bookType === "epub" ? "epub" : "pdf";
    return `${(ctx && ctx.title) || "文档"}.${ext}`;
  }

  function bookTypeLabel() {
    if (state.workMode) return "PDF";
    return state.ctx && state.ctx.bookType === "epub" ? "EPUB" : "PDF";
  }

  function fileBadge(name) {
    const ext = String(name).split(".").pop().toLowerCase();
    const map = {
      java: ["J", "java"],
      go: ["GO", "go"],
      ts: ["TS", "ts"],
      js: ["JS", "js"],
      xml: ["X", "xml"],
      yml: ["Y", "yml"],
      yaml: ["Y", "yml"],
      md: ["M", "md"],
      sh: ["SH", "sh"],
      sql: ["SQL", "sql"],
      json: ["{}", "json"],
    };
    const [label, cls] = map[ext] || ["·", "txt"];
    return `<span class="wr-ft wr-ft-${cls}">${label}</span>`;
  }

  function workTreeHtml(nodes, depth) {
    const d = depth || 0;
    return nodes
      .map((node) => {
        const pad = 8 + d * 14;
        const status = node.status
          ? `<span class="wr-git wr-git-${node.status.toLowerCase()}">${node.status}</span>`
          : "";
        if (node.type === "dir") {
          const open = state.workExpanded.has(node.path);
          return `<div class="wr-node wr-dir" data-path="${escapeAttr(node.path)}" style="padding-left:${pad}px" title="${escapeAttr(node.name)}">
            <span class="wr-caret">${open ? "▾" : "▸"}</span><span class="wr-node-name">${escapeHtml(node.name)}</span>
          </div>${open ? workTreeHtml(node.children, d + 1) : ""}`;
        }
        const active = state.workSelected === node.path ? " active" : "";
        return `<div class="wr-node wr-file${active}" data-path="${escapeAttr(node.path)}" style="padding-left:${pad + 12}px" title="${escapeAttr(node.name)}">
          ${fileBadge(node.name)}<span class="wr-node-name">${escapeHtml(node.name)}</span>${status}
        </div>`;
      })
      .join("");
  }

  const WORK_FAVICON =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#3b82f6"/><path d="M3 5.2h3.6l1.1 1.4H13v5.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="#fff" opacity=".92"/></svg>',
    );

  function applyWorkFavicon(on) {
    try {
      if (state.originalFavicons === null) {
        const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]'));
        state.originalFavicons = links.map((el) => ({ el, href: el.getAttribute("href") }));
      }
      const links = state.originalFavicons;
      if (on) {
        if (links.length) {
          links.forEach((item) => item.el.setAttribute("href", WORK_FAVICON));
        } else if (!state.createdFavicon) {
          const link = document.createElement("link");
          link.rel = "icon";
          link.href = WORK_FAVICON;
          (document.head || document.documentElement).appendChild(link);
          state.createdFavicon = link;
        }
      } else {
        links.forEach((item) => {
          if (!item.el) return;
          if (item.href == null) item.el.removeAttribute("href");
          else item.el.setAttribute("href", item.href);
        });
        if (state.createdFavicon) {
          state.createdFavicon.remove();
          state.createdFavicon = null;
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  function updateDocumentTitle() {
    try {
      applyWorkFavicon(!!state.workMode);
      if (state.workMode) document.title = `${WORK_DOC_NAME} · 工作目录`;
      else if (state.originalTitle) document.title = state.originalTitle;
      else if (state.ctx) document.title = `${state.ctx.title} - 微信读书`;
    } catch (e) {
      /* ignore */
    }
  }

  function restoreDocumentTitle() {
    try {
      applyWorkFavicon(false);
      if (state.originalTitle) document.title = state.originalTitle;
      else if (state.ctx) document.title = `${state.ctx.title} - 微信读书`;
    } catch (e) {
      /* ignore */
    }
  }

  function updatePreviewTitle() {
    const ui = state.ui;
    if (!ui) return;
    const el = ui.preview.querySelector(".wr-pv-title");
    if (el) el.textContent = workDocName();
  }

  function applyWorkMode(on) {
    state.workMode = !!on;
    storeSet(STORE.workMode, state.workMode);
    updateDocumentTitle();
    renderAll();
    updatePreviewTitle();
  }

  function toggleWorkMode() {
    applyWorkMode(!state.workMode);
  }

  function applyViewerLogsOnly(v) {
    if (!v || !v.els || !v.els.root) return;
    v.els.root.classList.toggle("logs-only", state.logsOnly);
    if (state.logsOnly) {
      v.logsOn = true;
      if (v.els.logPane) v.els.logPane.classList.remove("hidden");
      if (v.els.logResizer) v.els.logResizer.classList.remove("hidden");
      const btn = v.els.root.querySelector("#wr-pv-logs");
      if (btn) btn.classList.add("active");
      if (v.els.logEl) v.els.logEl.scrollTop = v.els.logEl.scrollHeight;
    } else if (v.kind !== "epub") {
      requestAnimationFrame(() => {
        if (state.viewer === v) relayout(v, true);
      });
    }
  }

  function toggleLogsOnly() {
    state.logsOnly = !state.logsOnly;
    storeSet(STORE.logsOnly, state.logsOnly);
    const v = state.viewer;
    if (v) applyViewerLogsOnly(v);
    renderChat();
    renderHead();
  }

  /* ============================== 官方界面隐藏 ============================== */

  function injectBaseStyle() {
    if (document.getElementById("wr-chat-base-style")) return;
    const style = document.createElement("style");
    style.id = "wr-chat-base-style";
    style.textContent = `
      html.wr-chat-on body > div:not(#${HOST_ID}),
      html.wr-chat-on body > main,
      html.wr-chat-on body > section {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html.wr-chat-on body { overflow: hidden !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function hideOfficial(on) {
    injectBaseStyle();
    document.documentElement.classList.toggle("wr-chat-on", !!on);
  }

  /* ============================== UI ============================== */

  function ensureRoot() {
    if (state.ui || !document.body) return state.ui;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .wr-shell {
          position: fixed; inset: 0; display: flex; background: #ededed; color: #191919;
          font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .wr-side {
          width: 280px; flex: 0 0 280px; background: #f7f7f7;
          display: flex; flex-direction: column; min-height: 0;
        }
        .wr-resizer {
          width: 1px; flex: 0 0 1px; position: relative; cursor: col-resize;
          background: #e2e2e2; touch-action: none;
        }
        .wr-resizer::after {
          content: ""; position: absolute; top: 0; bottom: 0; left: -3px; right: -3px; cursor: col-resize;
        }
        .wr-resizer:hover, .wr-resizer.dragging { background: #07c160; }
        .wr-side-head { height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; }
        .wr-side-title { font-size: 15px; font-weight: 600; letter-spacing: .5px; cursor: pointer; user-select: none; }
        .wr-side-title:hover { color: #07c160; }
        .wr-refresh {
          border: 0; background: transparent; color: #8b8b8b; cursor: pointer; font-size: 15px;
          padding: 4px 6px; border-radius: 4px; line-height: 1;
        }
        .wr-refresh:hover { background: #ececec; color: #555; }
        .wr-list { flex: 1; overflow: auto; padding-bottom: 8px; }
        .wr-item { display: flex; align-items: center; gap: 10px; padding: 9px 14px; cursor: pointer; }
        .wr-item:hover { background: #ececec; }
        .wr-item.active { background: #dcdcdc; }
        .wr-item.disabled { cursor: default; opacity: .62; }
        .wr-avatar {
          width: 40px; height: 40px; flex: 0 0 40px; border-radius: 4px; object-fit: cover; background: #d8d8d8;
          display: flex; align-items: center; justify-content: center; color: #fff; font-size: 16px; overflow: hidden;
        }
        .wr-item-main { flex: 1; min-width: 0; }
        .wr-item-title { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wr-item-sub { margin-top: 3px; font-size: 12px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wr-item-time { align-self: flex-start; margin-top: 2px; font-size: 11px; color: #b3b3b3; }
        .wr-side-foot {
          height: 34px; display: flex; align-items: center; justify-content: center;
          font-size: 11px; color: #aaa; border-top: 1px solid #ececec;
        }
        .wr-tree { padding: 4px 0 10px; }
        .wr-workspace {
          display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; cursor: pointer;
          font: 600 11px Consolas, "SFMono-Regular", Menlo, monospace; color: #333;
        }
        .wr-workspace:hover { background: #ececec; }
        .wr-workspace-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .wr-branch {
          display: flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px 0 20px; cursor: pointer;
          font: 11px Consolas, "SFMono-Regular", Menlo, monospace; color: #666;
        }
        .wr-branch:hover { background: #ececec; }
        .wr-branch-name { color: #333; }
        .wr-changes { margin-left: auto; color: #b7791f; }
        .wr-branch-menu {
          margin: 2px 10px 8px; padding: 3px 0; background: #fff; border: 1px solid #e2e2e2;
          border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.08);
        }
        .wr-branch-item { padding: 4px 10px; font: 11px Consolas, monospace; color: #555; cursor: pointer; }
        .wr-branch-item:hover { background: #f2f2f2; }
        .wr-branch-item.active { color: #07c160; }
        .wr-node {
          display: flex; align-items: center; gap: 5px; height: 26px; padding-right: 10px; cursor: pointer;
          color: #555; font: 12px/1.4 Consolas, "SFMono-Regular", Menlo, monospace;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .wr-node:hover { background: #ececec; }
        .wr-node.active { background: #dcdcdc; color: #111; }
        .wr-caret { width: 10px; flex: 0 0 10px; text-align: center; color: #9a9a9a; font-size: 10px; }
        .wr-node-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .wr-dir .wr-node-name { color: #333; }
        .wr-file .wr-node-name { color: #666; }
        .wr-ft {
          width: 16px; height: 16px; flex: 0 0 16px; border-radius: 2px; text-align: center;
          font: 9px/16px Consolas, monospace; color: #fff;
        }
        .wr-ft-java { background: #b07219; }
        .wr-ft-go { background: #00add8; }
        .wr-ft-ts { background: #3178c6; }
        .wr-ft-js { background: #d9c93b; color: #333; }
        .wr-ft-xml { background: #e37933; }
        .wr-ft-yml { background: #8e6bbf; }
        .wr-ft-md { background: #7a8089; }
        .wr-ft-sh { background: #2f9e44; }
        .wr-ft-sql { background: #336791; }
        .wr-ft-json { background: #8a8f98; }
        .wr-ft-txt { background: #b0b5bd; }
        .wr-git { flex: 0 0 auto; margin-left: 2px; font: 10px Consolas, monospace; }
        .wr-git-m { color: #d19a66; }
        .wr-git-u { color: #07c160; }
        .wr-git-d { color: #c0392b; }
        .wr-main { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: #f5f5f5; }
        .wr-head {
          height: 60px; display: flex; align-items: center; gap: 10px; padding: 0 18px;
          background: #f5f5f5; border-bottom: 1px solid #e2e2e2;
        }
        .wr-head-cover { width: 32px; height: 32px; flex: 0 0 32px; border-radius: 4px; object-fit: cover; }
        .wr-head-doc {
          width: 32px; height: 32px; flex: 0 0 32px; border-radius: 4px; background: #fdecea; color: #df4d4d;
          font: 700 10px/32px Consolas, monospace; text-align: center; letter-spacing: .5px;
        }
        .wr-head-main { min-width: 0; }
        .wr-head-title {
          font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          cursor: pointer;
        }
        .wr-head-title:hover { color: #07c160; }
        .wr-head-sub { margin-top: 1px; font-size: 12px; color: #999; }
        .wr-head-spacer { flex: 1; }
        .wr-exit {
          border: 0; background: transparent; color: #666; cursor: pointer; font-size: 17px;
          padding: 6px 9px; border-radius: 4px; line-height: 1;
        }
        .wr-exit:hover { background: #e9e9e9; color: #111; }
        .wr-chat { flex: 1; overflow: auto; padding: 24px 28px; display: flex; flex-direction: column; align-items: flex-start; }
        .wr-sys { align-self: center; color: #a3a3a3; font-size: 12px; margin: 4px 0 20px; }
        .wr-file {
          width: 320px; max-width: 82%; background: #fff; border: 1px solid #ececec; border-radius: 6px;
          padding: 14px 16px; display: flex; gap: 12px; align-items: center; cursor: pointer;
          box-shadow: 0 1px 1px rgba(0,0,0,.02);
        }
        .wr-file:hover { background: #fafafa; }
        .wr-file-icon {
          width: 44px; height: 44px; flex: 0 0 44px; border-radius: 5px; background: #fdecea;
          color: #df4d4d; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center;
          letter-spacing: .5px;
        }
        .wr-file-icon.epub { background: #e8f5ee; color: #07945a; font-size: 10px; }
        .wr-file-main { min-width: 0; }
        .wr-file-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wr-file-sub { margin-top: 4px; font-size: 12px; color: #999; }
        .wr-preview { position: absolute; inset: 0; z-index: 5; background: #fff; }
        .wr-preview[hidden] { display: none; }
        .wr-pv { position: absolute; inset: 0; display: flex; flex-direction: column; background: #fff; color: #191919; }
        .wr-pv-bar {
          height: 44px; flex: 0 0 44px; display: flex; align-items: center; gap: 5px; padding: 0 10px;
          background: #fff; border-bottom: 1px solid #ececec;
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .wr-pv-title {
          max-width: 34%; font-size: 12px; color: #333; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; padding-left: 4px; cursor: pointer;
        }
        .wr-pv-title:hover { color: #07c160; }
        .wr-pv-spacer { flex: 1; }
        .wr-pv-btn {
          border: 0; background: transparent; color: #666; cursor: pointer; padding: 4px 7px;
          border-radius: 4px; font: 12px/1.4 inherit; line-height: 1.4;
        }
        .wr-pv-btn:hover { background: #e9e9e9; color: #111; }
        .wr-pv-btn.active { color: #07c160; }
        .wr-pv-pageno { display: inline-flex; align-items: center; gap: 4px; color: #8a8f98; font: 11px Consolas, monospace; }
        .wr-pv-pageno input {
          width: 38px; background: #fff; border: 1px solid #dcdcdc; border-radius: 3px; color: #333;
          text-align: center; font: 11px Consolas, monospace; padding: 2px 0; outline: none;
        }
        .wr-pv-pageno input:focus { border-color: #07c160; }
        .wr-pv-zoom { min-width: 42px; text-align: center; color: #8a8f98; font: 11px Consolas, monospace; }
        .wr-pv-body { flex: 1; min-height: 0; display: flex; }
        .wr-pv-main { position: relative; flex: 1; min-width: 0; background: #fff; overflow: hidden; }
        .wr-pv-logpane {
          width: 340px; flex: 0 0 auto; display: flex; flex-direction: column;
          min-height: 0; background: #fbfbfb;
        }
        .wr-pv-logpane.hidden { display: none; }
        .wr-pv.logs-only .wr-pv-main { display: none; }
        .wr-pv.logs-only .wr-pv-logresizer { display: none; }
        .wr-pv.logs-only .wr-pv-logpane { flex: 1 1 auto; width: auto !important; }
        .wr-pv.logs-only #wr-pv-prev,
        .wr-pv.logs-only #wr-pv-next,
        .wr-pv.logs-only .wr-pv-pageno,
        .wr-pv.logs-only #wr-pv-zoom-out,
        .wr-pv.logs-only #wr-pv-zoom-in,
        .wr-pv.logs-only .wr-pv-zoom,
        .wr-pv.logs-only #wr-pv-fit { display: none; }
        .wr-pv-logresizer {
          width: 1px; flex: 0 0 1px; position: relative; cursor: col-resize;
          background: #e2e2e2; touch-action: none;
        }
        .wr-pv-logresizer::after {
          content: ""; position: absolute; top: 0; bottom: 0; left: -3px; right: -3px; cursor: col-resize;
        }
        .wr-pv-logresizer:hover, .wr-pv-logresizer.dragging { background: #07c160; }
        .wr-pv-logresizer.hidden { display: none; }
        .wr-pv-loghead {
          height: 34px; flex: 0 0 34px; display: flex; align-items: center; gap: 7px; padding: 0 12px;
          border-bottom: 1px solid #ececec; color: #8a8f98; font-size: 11px; letter-spacing: .5px;
        }
        .wr-pv-dot {
          width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: #07c160;
          box-shadow: 0 0 0 3px rgba(7,193,96,.12);
        }
        .wr-pv-log {
          flex: 1; min-height: 0; overflow: hidden; padding: 6px 12px 10px;
          color: #8a8f98; font: 11px/1.7 Consolas, "SFMono-Regular", Menlo, monospace;
        }
        .wr-log-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wr-log-t { color: #b0b5bd; }
        .wr-log-lv { display: inline-block; min-width: 38px; }
        .wr-log-info { color: #3f8f5f; }
        .wr-log-debug { color: #9aa0a8; }
        .wr-log-warn { color: #b7791f; }
        .wr-log-error { color: #c0392b; }
        .wr-log-svc { display: inline-block; min-width: 92px; color: #6b7c93; }
        .wr-log-msg { color: #6b7280; }
        .wr-log-src { margin-left: auto; font: 10px Consolas, monospace; color: #b0b5bd; letter-spacing: .5px; }
        .wr-log-src.live { color: #07c160; }
        .wr-log-src.err { color: #c0392b; }
        .wr-log-empty { padding: 10px 2px; color: #b0b5bd; }
        .wr-pv-scroll { position: absolute; inset: 0; overflow: auto; scrollbar-color: #cbd0d6 #fff; }
        .wr-pv-scroll::-webkit-scrollbar { width: 10px; }
        .wr-pv-scroll::-webkit-scrollbar-thumb { background: #cbd0d6; border-radius: 5px; }
        .wr-pv-scroll::-webkit-scrollbar-track { background: #fff; }
        .wr-pv-pages { display: block; padding: 0; min-height: 100%; }
        .wr-pv-page {
          background: #fff; overflow: hidden; margin: 0 auto; position: relative;
        }
        .wr-pv-page canvas { display: block; width: 100%; height: auto; }
        .wr-pv-page-ph { height: 100%; display: flex; align-items: center; justify-content: center; color: #cfcfcf; font: 12px Consolas, monospace; }
        .wr-pv-page-err { height: 100%; display: flex; align-items: center; justify-content: center; color: #b45; font-size: 12px; }
        .wr-pv-status {
          position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,.96); color: #8a8f98; font-size: 13px; text-align: center; line-height: 2;
        }
        .wr-pv-status button {
          border: 1px solid #d5d5d5; background: #fff; color: #333; border-radius: 5px;
          padding: 5px 12px; font-size: 12px; cursor: pointer; margin: 0 4px;
        }
        .wr-pv-status button:hover { background: #f5f5f5; }
        .wr-link {
          font-size: 12px; color: #576b95; text-decoration: none; padding: 5px 8px; border-radius: 4px;
        }
        .wr-link:hover { background: #ececec; }
        .wr-chat.is-logs { padding: 0; align-items: stretch; overflow: hidden; }
        .wr-chatlog { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #fbfbfb; }
        .wr-chatlog-head {
          height: 34px; flex: 0 0 34px; display: flex; align-items: center; gap: 7px; padding: 0 14px;
          border-bottom: 1px solid #ececec; color: #8a8f98; font-size: 11px; letter-spacing: .5px;
        }
        .wr-chatlog-body {
          flex: 1; min-height: 0; overflow: hidden; padding: 8px 14px;
          color: #8a8f98; font: 11px/1.7 Consolas, "SFMono-Regular", Menlo, monospace;
        }
        .wr-epub-scroll { position: absolute; inset: 0; overflow: auto; background: #fff; }
        .wr-epub-page { display: block; max-width: 880px; margin: 0 auto; padding: 40px 48px 90px; background: #fff; }
        .wr-epub-chapter {
          max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          color: #666; font-size: 12px;
        }
        .wr-epub-toc { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; background: #fff; }
        .wr-epub-toc.hidden { display: none; }
        .wr-epub-toc-head {
          height: 44px; flex: 0 0 44px; display: flex; align-items: center; justify-content: space-between;
          padding: 0 14px; border-bottom: 1px solid #ececec; font-size: 13px; color: #333;
        }
        .wr-epub-toc-head button { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: #888; }
        .wr-epub-toc-list { flex: 1; overflow: auto; padding: 6px 0 20px; }
        .wr-epub-toc-item {
          padding: 5px 18px; font-size: 13px; color: #444; cursor: pointer;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .wr-epub-toc-item:hover { background: #f5f5f5; }
        .wr-epub-toc-item.active { color: #07c160; background: #f2f9f5; }
        .wr-epub-toc-item.level2 { padding-left: 36px; font-size: 12px; color: #777; }
        .wr-epub-toc-item.level3 { padding-left: 52px; font-size: 12px; color: #888; }
        .wr-ball {
          position: fixed; right: 24px; bottom: 24px; width: 48px; height: 48px; border-radius: 50%;
          background: #07c160; color: #fff; font-size: 18px; display: flex; align-items: center; justify-content: center;
          cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.22); user-select: none;
        }
        .wr-ball[hidden] { display: none; }
        .wr-toast {
          position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); background: rgba(0,0,0,.76);
          color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; opacity: 0;
          transition: opacity .18s ease; pointer-events: none;
        }
        .wr-toast.show { opacity: 1; }
      </style>
      <div class="wr-shell" id="shell">
        <aside class="wr-side">
          <div class="wr-side-head">
            <span class="wr-side-title" id="wr-side-title" title="切换书籍 / 工作目录">微信读书</span>
            <button class="wr-refresh" id="refresh" title="刷新书架">↻</button>
          </div>
          <div class="wr-list" id="list"></div>
          <div class="wr-side-foot" id="wr-side-foot">仅显示支持 PDF 阅读的书</div>
        </aside>
        <div class="wr-resizer" id="wr-resizer-left" title="拖动调整宽度"></div>
        <main class="wr-main" id="main">
          <div class="wr-head" id="head"></div>
          <div class="wr-chat" id="chat"></div>
          <div class="wr-preview" id="preview" hidden></div>
        </main>
      </div>
      <div class="wr-ball" id="ball" hidden>微</div>
      <div class="wr-toast" id="toast"></div>
    `;
    document.body.appendChild(host);
    const baseStyle = document.getElementById("wr-chat-base-style");
    if (baseStyle && document.head && baseStyle.parentNode !== document.head) {
      document.head.appendChild(baseStyle);
    }

    const $ = (sel) => shadow.querySelector(sel);
    const ui = {
      host,
      shadow,
      shell: $("#shell"),
      list: $("#list"),
      head: $("#head"),
      chat: $("#chat"),
      preview: $("#preview"),
      ball: $("#ball"),
      toast: $("#toast"),
      sideTitle: $("#wr-side-title"),
      sideFoot: $("#wr-side-foot"),
      side: shadow.querySelector(".wr-side"),
      leftResizer: $("#wr-resizer-left"),
    };
    state.ui = ui;

    applyLeftWidth(state.leftWidth);
    bindHorizontalDrag(ui.leftResizer, {
      getWidth: () => state.leftWidth,
      min: 220,
      max: () => 460,
      onMove: (w) => {
        applyLeftWidth(w);
        liveResizeViewer();
      },
      onEnd: () => {
        storeSet(STORE.leftWidth, state.leftWidth);
        const v = state.viewer;
        if (v) {
          state.logWidth = applyLogWidth(v, state.logWidth);
          storeSet(STORE.logWidth, state.logWidth);
          relayout(v, true);
        }
      },
    });

    const sideTitle = $("#wr-side-title");
    if (sideTitle) sideTitle.addEventListener("click", toggleWorkMode);

    $("#refresh").addEventListener("click", () => {
      if (state.workMode) {
        renderSidebar();
        return;
      }
      state.shelf = [];
      loadShelf(true);
      toast("正在刷新书架…");
    });
    ui.list.addEventListener("click", (ev) => {
      if (state.workMode) {
        const branchItem = ev.target.closest(".wr-branch-item");
        if (branchItem) {
          state.workBranch = branchItem.getAttribute("data-branch") || "main";
          state.branchMenuOpen = false;
          renderSidebar();
          return;
        }
        if (ev.target.closest("#wr-branch")) {
          state.branchMenuOpen = !state.branchMenuOpen;
          renderSidebar();
          return;
        }
        if (ev.target.closest("#wr-workspace")) {
          state.workCollapsed = !state.workCollapsed;
          state.branchMenuOpen = false;
          renderSidebar();
          return;
        }
        const node = ev.target.closest(".wr-node");
        if (!node) return;
        const path = node.getAttribute("data-path");
        const item = WORK_INDEX.get(path);
        if (!item) return;
        if (item.type === "dir") {
          if (state.workExpanded.has(path)) state.workExpanded.delete(path);
          else state.workExpanded.add(path);
          renderSidebar();
        } else {
          state.workSelected = path;
          renderSidebar();
        }
        return;
      }
      const row = ev.target.closest(".wr-item");
      if (!row) return;
      const key = row.getAttribute("data-key");
      const book = mergedBooks().find((b) => b.key === key);
      if (!book) return;
      if (!book.readerUrl) {
        toast("请先在官方书架打开一次这本书，之后会出现在这里");
        return;
      }
      if (state.ctx && book.key === state.ctx.key) {
        hidePreview();
        return;
      }
      location.href = book.readerUrl;
    });
    ui.ball.addEventListener("click", enterMode);
    document.addEventListener("keydown", onKeydown);
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener("resize", () => applyViewport());
    }
    return ui;
  }

  function onKeydown(ev) {
    if (ev.key === "Escape" && state.previewOpen) hidePreview();
  }

  function toast(message) {
    const ui = state.ui;
    if (!ui) return;
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => ui.toast.classList.remove("show"), 2200);
  }

  function avatarHtml(book, cls) {
    if (book.cover) {
      return `<img class="${cls}" src="${escapeAttr(book.cover)}" alt="" loading="lazy">`;
    }
    return `<span class="${cls}" style="display:flex;align-items:center;justify-content:center;background:#c9c9c9;color:#fff;font-size:16px;">${escapeHtml(
      (book.title || "?").slice(0, 1),
    )}</span>`;
  }

  function renderSidebar() {
    const ui = state.ui;
    if (!ui) return;
    if (state.workMode) {
      ui.sideTitle.textContent = "工作目录";
      ui.sideFoot.textContent = `Java 17 · Maven · ${state.workBranch}`;
      const branches = ["main", "develop", "release/2026.11", "feature/order-refactor"];
      const menu = state.branchMenuOpen
        ? `<div class="wr-branch-menu">${branches
            .map(
              (b) =>
                `<div class="wr-branch-item ${b === state.workBranch ? "active" : ""}" data-branch="${escapeAttr(b)}">${escapeHtml(b)}</div>`,
            )
            .join("")}</div>`
        : "";
      ui.list.innerHTML = `<div class="wr-tree">
        <div class="wr-workspace" id="wr-workspace" title="折叠/展开工作区">
          <span class="wr-caret">${state.workCollapsed ? "▸" : "▾"}</span>
          <span class="wr-workspace-name">ttigd-manage-web</span>
        </div>
        ${
          state.workCollapsed
            ? ""
            : `<div class="wr-branch" id="wr-branch" title="切换分支">
                <span class="wr-branch-name">${escapeHtml(state.workBranch)}</span>
                <span class="wr-caret">▾</span>
                <span class="wr-changes">3 changes</span>
              </div>
              ${menu}
              ${workTreeHtml(WORK_TREE, 0)}`
        }
      </div>`;
      return;
    }
    ui.sideTitle.textContent = "微信读书";
    ui.sideFoot.textContent = "仅显示支持 PDF / EPUB 的书";
    const books = mergedBooks();
    ui.list.innerHTML = books
      .map((b) => {
        const active = state.ctx && b.key === state.ctx.key;
        const disabled = !b.readerUrl && !active;
        const type = b.bookType === "epub" ? "EPUB" : "PDF";
        const sub = active
          ? `${type} 文档 · 点击卡片阅读`
          : disabled
            ? `${type} · 请先在官方书架点开一次`
            : `${type} · ${b.lastReadAt ? timeAgo(b.lastReadAt) : "尚未打开"}`;
        return `<div class="wr-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}" data-key="${escapeAttr(
          b.key,
        )}" title="${escapeAttr(b.title)}">
          ${avatarHtml(b, "wr-avatar")}
          <div class="wr-item-main">
            <div class="wr-item-title">${escapeHtml(b.title)}</div>
            <div class="wr-item-sub">${escapeHtml(sub)}</div>
          </div>
          <span class="wr-item-time">${escapeHtml(b.lastReadAt ? timeAgo(b.lastReadAt) : "")}</span>
        </div>`;
      })
      .join("");
  }

  function renderHead() {
    const ui = state.ui;
    const ctx = state.ctx;
    if (!ui || !ctx) return;
    if (state.workMode) {
      ui.head.innerHTML = `
        <span class="wr-head-doc">PDF</span>
        <div class="wr-head-main">
          <div class="wr-head-title" id="wr-head-title" title="点击隐藏/显示阅读区">${escapeHtml(WORK_DOC_NAME)}</div>
          <div class="wr-head-sub">工作文档 · PDF</div>
        </div>
        <span class="wr-head-spacer"></span>
        <button class="wr-exit" id="wr-exit" title="退出微信模式">⏏</button>
      `;
    } else {
      const sub = ctx.author ? `${ctx.author} · ${bookTypeLabel()}` : `${bookTypeLabel()} 文档`;
      ui.head.innerHTML = `
        ${avatarHtml(ctx, "wr-head-cover")}
        <div class="wr-head-main">
          <div class="wr-head-title" id="wr-head-title" title="点击隐藏/显示阅读区">${escapeHtml(ctx.title)}</div>
          <div class="wr-head-sub">${escapeHtml(sub)}</div>
        </div>
        <span class="wr-head-spacer"></span>
        <button class="wr-exit" id="wr-exit" title="退出微信模式">⏏</button>
      `;
    }
    const headTitle = ui.head.querySelector("#wr-head-title");
    if (headTitle) headTitle.addEventListener("click", toggleLogsOnly);
    const exitBtn = ui.head.querySelector("#wr-exit");
    if (exitBtn) exitBtn.addEventListener("click", exitMode);
  }

  function renderChat() {
    const ui = state.ui;
    const ctx = state.ctx;
    if (!ui || !ctx) return;
    stopChatLogs();
    if (state.logsOnly && !state.viewer) {
      ui.chat.classList.add("is-logs");
      ui.chat.innerHTML = `<div class="wr-chatlog">
        <div class="wr-chatlog-head"><span class="wr-pv-dot"></span>运行日志<span class="wr-log-src" id="wr-chatlog-src">模拟</span></div>
        <div class="wr-chatlog-body" id="wr-chatlog-body"></div>
      </div>`;
      startChatLogs();
      return;
    }
    ui.chat.classList.remove("is-logs");
    const docName = workDocName();
    ui.chat.innerHTML = `
      <div class="wr-sys">—— ${escapeHtml(docName)} ——</div>
      <div class="wr-file" id="wr-file" role="button" tabindex="0" title="点击打开文档">
        <div class="wr-file-icon ${ctx.bookType === "epub" ? "epub" : ""}">${bookTypeLabel()}</div>
        <div class="wr-file-main">
          <div class="wr-file-name">${escapeHtml(docName)}</div>
          <div class="wr-file-sub">${bookTypeLabel()} 文档 · 点击阅读</div>
        </div>
      </div>
    `;
    const card = ui.chat.querySelector("#wr-file");
    if (card) {
      card.addEventListener("click", openPreview);
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openPreview();
        }
      });
    }
  }

  function renderAll() {
    renderSidebar();
    renderHead();
    renderChat();
  }

  /* ============================== PDF 预览 ============================== */

  async function resolvePdfUrl() {
    const ctx = state.ctx;
    if (!ctx) return "";
    const fresh = signals.cosUrl && Date.now() - signals.cosAt < 8 * 60 * 1000;
    const sameBook = !ctx.cbBookId || !signals.cosUrlBookId || signals.cosUrlBookId === ctx.cbBookId;
    if (fresh && sameBook) return signals.cosUrl;

    if (!ctx.cbBookId) {
      if (ctx.pdfUrl) return ctx.pdfUrl;
      return fresh ? signals.cosUrl : "";
    }
    try {
      const fetchFn = typeof W.fetch === "function" ? W.fetch : window.fetch;
      const url = `https://res.weread.qq.com/cos/download?getUrl=1&bookId=${encodeURIComponent(ctx.cbBookId)}`;
      const res = await fetchFn.call(W, url, {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
      });
      if (!res || !res.ok) throw new Error(`cos ${res && res.status}`);
      const j = await res.json();
      const next = j && (j.url || (j.data && j.data.url));
      if (next) {
        signals.cosUrl = next;
        signals.cosUrlBookId = ctx.cbBookId;
        signals.cosAt = Date.now();
        return next;
      }
    } catch (e) {
      warn("获取 PDF 地址失败", e && e.message ? e.message : e);
    }
    if (ctx.pdfUrl) return ctx.pdfUrl;
    return fresh ? signals.cosUrl : "";
  }

  function setPreviewStatus(text) {
    const ui = state.ui;
    if (!ui) return;
    const el = ui.preview.querySelector(".wr-pv-status");
    if (el) el.textContent = text;
  }

  function gmFetchArrayBuffer(url, onProgress, headers) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("当前脚本管理器不支持 GM_xmlhttpRequest"));
        return;
      }
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          headers: headers || undefined,
          responseType: "arraybuffer",
          timeout: 120000,
          onprogress: (ev) => {
            try {
              if (ev && ev.lengthComputable && typeof onProgress === "function")
                onProgress(ev.loaded, ev.total);
            } catch (e) {
              /* ignore */
            }
          },
          onload: (res) => {
            if (res && res.status >= 200 && res.status < 300 && res.response) done(resolve, res.response);
            else done(reject, new Error(`HTTP ${(res && res.status) || 0}`));
          },
          onerror: () => done(reject, new Error("网络错误")),
          ontimeout: () => done(reject, new Error("下载超时")),
        });
      } catch (e) {
        done(reject, e);
      }
    });
  }

  async function downloadPdfBytes(url, onProgress) {
    let buf = null;
    let gmError = null;
    try {
      buf = await gmFetchArrayBuffer(url, onProgress);
    } catch (e1) {
      try {
        buf = await gmFetchArrayBuffer(url, onProgress, { Referer: "https://weread.qq.com/" });
      } catch (e2) {
        gmError = e2;
        warn("GM 下载失败，尝试页面 fetch", e2 && e2.message ? e2.message : e2);
      }
    }
    if (!buf) {
      const fetchFn = typeof W.fetch === "function" ? W.fetch : window.fetch;
      const res = await fetchFn.call(W, url, { credentials: "omit" });
      if (!res || !res.ok) {
        throw new Error(`HTTP ${(res && res.status) || 0}${gmError ? `（GM：${gmError.message}）` : ""}`);
      }
      buf = await res.arrayBuffer();
    }
    if (!buf || (buf.byteLength != null && buf.byteLength === 0)) throw new Error("文档内容为空");
    return buf;
  }

  function getPdfjs() {
    try {
      if (typeof pdfjsLib !== "undefined" && pdfjsLib) return pdfjsLib;
    } catch (e) {
      /* ignore */
    }
    try {
      return W.pdfjsLib || (typeof window !== "undefined" ? window.pdfjsLib : null);
    } catch (e) {
      return null;
    }
  }

  let pdfWorkerText = "";
  let pdfWorkerBlobUrl = "";
  let pdfMainWorkerReady = false;

  async function getPdfWorkerText() {
    if (pdfWorkerText) return pdfWorkerText;
    try {
      const fetchFn = typeof W.fetch === "function" ? W.fetch : window.fetch;
      const res = await fetchFn.call(W, PDFJS_WORKER);
      if (res && res.ok) pdfWorkerText = await res.text();
    } catch (e) {
      /* 走 GM */
    }
    if (!pdfWorkerText) {
      pdfWorkerText = await new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== "function") {
          reject(new Error("无法加载 PDF worker"));
          return;
        }
        try {
          GM_xmlhttpRequest({
            method: "GET",
            url: PDFJS_WORKER,
            timeout: 60000,
            onload: (r) =>
              r && r.status >= 200 && r.status < 300
                ? resolve(r.responseText || "")
                : reject(new Error(`worker HTTP ${(r && r.status) || 0}`)),
            onerror: () => reject(new Error("worker 网络错误")),
            ontimeout: () => reject(new Error("worker 下载超时")),
          });
        } catch (e) {
          reject(e);
        }
      });
    }
    if (!pdfWorkerText) throw new Error("PDF worker 内容为空");
    return pdfWorkerText;
  }

  async function getPdfWorkerBlobUrl() {
    if (pdfWorkerBlobUrl) return pdfWorkerBlobUrl;
    const text = await getPdfWorkerText();
    const URLapi = W.URL || URL;
    pdfWorkerBlobUrl = URLapi.createObjectURL(new Blob([text], { type: "text/javascript" }));
    return pdfWorkerBlobUrl;
  }

  async function ensureMainThreadPdfWorker() {
    if (pdfMainWorkerReady) return true;
    try {
      if (globalThis.pdfjsWorker && globalThis.pdfjsWorker.WorkerMessageHandler) {
        pdfMainWorkerReady = true;
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    const text = await getPdfWorkerText();
    try {
      (0, eval)(text);
    } catch (e) {
      try {
        new Function(text)();
      } catch (e2) {
        return false;
      }
    }
    try {
      pdfMainWorkerReady = !!(globalThis.pdfjsWorker && globalThis.pdfjsWorker.WorkerMessageHandler);
    } catch (e) {
      pdfMainWorkerReady = false;
    }
    return pdfMainWorkerReady;
  }

  function hasMainPdfWorker() {
    try {
      if (globalThis.pdfjsWorker && globalThis.pdfjsWorker.WorkerMessageHandler) return true;
    } catch (e) {
      /* ignore */
    }
    try {
      if (W.pdfjsWorker && W.pdfjsWorker.WorkerMessageHandler) {
        try {
          globalThis.pdfjsWorker = W.pdfjsWorker;
        } catch (e) {
          /* ignore */
        }
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  async function openPdfDocument(buf) {
    const lib = getPdfjs();
    if (!lib) throw new Error("PDF 渲染库未加载（@require 失败或离线）");
    const opts = {
      cMapUrl: `${PDFJS_BASE}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    };
    const copy = () => {
      try {
        return buf.slice(0);
      } catch (e) {
        return new Uint8Array(buf).slice().buffer;
      }
    };
    const attempt = async (data, disableWorker) => {
      const task = lib.getDocument({ ...opts, data, disableWorker: !!disableWorker });
      return await task.promise;
    };

    let lastErr = null;
    if (hasMainPdfWorker()) {
      try {
        return await attempt(copy(), true);
      } catch (e) {
        lastErr = e;
      }
    }
    try {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return await attempt(copy(), false);
    } catch (e) {
      lastErr = e;
    }
    try {
      lib.GlobalWorkerOptions.workerSrc = await getPdfWorkerBlobUrl();
      return await attempt(copy(), false);
    } catch (e) {
      lastErr = e;
    }
    try {
      if (await ensureMainThreadPdfWorker()) {
        try {
          lib.GlobalWorkerOptions.workerSrc = "";
        } catch (e) {
          /* ignore */
        }
        return await attempt(buf, true);
      }
    } catch (e) {
      lastErr = e;
    }
    throw lastErr || new Error("PDF 加载失败");
  }

  function pvBarHtml(extra) {
    const title = workDocName();
    return `<div class="wr-pv-bar">
      <button class="wr-pv-btn" id="wr-pv-back">‹ 返回</button>
      <span class="wr-pv-title" id="wr-pv-title" title="点击隐藏/显示阅读区">${escapeHtml(title)}</span>
      <span class="wr-pv-spacer"></span>
      ${extra || ""}
    </div>`;
  }

  function bindPreviewBack() {
    const ui = state.ui;
    if (!ui) return;
    const back = ui.preview.querySelector("#wr-pv-back");
    if (back) back.addEventListener("click", hidePreview);
  }

  function showPreviewLoading(message) {
    const ui = state.ui;
    if (!ui) return;
    state.previewOpen = true;
    ui.preview.hidden = false;
    ui.preview.innerHTML = `<div class="wr-pv">
      ${pvBarHtml("")}
      <div class="wr-pv-body">
        <div class="wr-pv-main">
          <div class="wr-pv-status">${escapeHtml(message || "正在获取文档…")}</div>
        </div>
      </div>
    </div>`;
    bindPreviewBack();
  }

  function showPreviewError(message, url) {
    const ui = state.ui;
    if (!ui) return;
    ui.preview.hidden = false;
    ui.preview.innerHTML = `<div class="wr-pv">
      ${pvBarHtml("")}
      <div class="wr-pv-body">
        <div class="wr-pv-main">
          <div class="wr-pv-status">
            <div>${escapeHtml(message || "文档打开失败")}</div>
            <div style="margin-top:12px;">
              <button id="wr-retry">重新获取</button>
              ${url ? `<a class="wr-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">下载原文件</a>` : ""}
            </div>
          </div>
        </div>
      </div>
    </div>`;
    bindPreviewBack();
    const retry = ui.preview.querySelector("#wr-retry");
    if (retry) {
      retry.addEventListener("click", () => {
        signals.cosUrl = "";
        signals.cosAt = 0;
        openPreview();
      });
    }
  }

  /* ---------- 工作日志背景 ---------- */

  const LOG_TEMPLATES = [
    ["INFO", "api-gateway", () => `POST /api/v2/orders 200 ${randInt(8, 120)}ms trace=${hexId(12)}`, 6],
    ["INFO", "api-gateway", () => `GET /api/v2/products?page=${randInt(1, 20)} 200 ${randInt(10, 60)}ms`, 4],
    ["DEBUG", "auth-service", () => `token refresh uid=${randInt(1000, 9999)} exp=3600s`, 2],
    [
      "INFO",
      "order-service",
      () => `kafka order.created partition=${randInt(0, 5)} offset=${randInt(10000, 99999)}`,
      4,
    ],
    ["DEBUG", "redis", () => `GET sku:${randInt(1000, 9999)} hit=1 ttl=${randInt(60, 600)}`, 2],
    [
      "INFO",
      "search-service",
      () => `query "${pickWord()}" hits=${randInt(2, 200)} took=${randInt(5, 80)}ms`,
      3,
    ],
    ["INFO", "ci-runner", () => `[build ${randInt(4700, 4999)}] npm test — ${randInt(180, 400)} passed`, 2],
    ["INFO", "deploy", () => `staging ${hexId(7)} rolled out ${randInt(1, 4)}/4`, 1],
    ["WARN", "inventory", () => `stock below threshold sku=SKU-${randInt(1000, 9999)}`, 1],
    [
      "INFO",
      "payment",
      () => `settlement batch=${randInt(100, 999)} amount=¥${randInt(10, 999)}.${randInt(10, 99)}`,
      2,
    ],
    ["DEBUG", "mysql", () => `SELECT id,status FROM orders WHERE id=? (${randInt(2, 40)}ms)`, 2],
    ["ERROR", "payment", () => `upstream bank timeout retry=${randInt(1, 3)}/3`, 1],
  ];
  const LOG_POOL = (() => {
    const pool = [];
    for (const t of LOG_TEMPLATES) for (let i = 0; i < (t[3] || 1); i++) pool.push(t);
    return pool;
  })();
  const LOG_WORDS = ["orders", "refund", "inventory", "session", "report", "invoice", "coupon", "shipment"];

  function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function hexId(n) {
    const h = "0123456789abcdef";
    let s = "";
    for (let i = 0; i < n; i++) s += h[Math.floor(Math.random() * 16)];
    return s;
  }

  function pickWord() {
    return LOG_WORDS[Math.floor(Math.random() * LOG_WORDS.length)];
  }

  function pickLogTemplate() {
    return LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)];
  }

  function logTimestamp() {
    const d = new Date(Date.now() - randInt(0, 8000));
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function logLineHtml() {
    const [level, svc, msgFn] = pickLogTemplate();
    const cls = level.toLowerCase();
    return `<div class="wr-log-line">
      <span class="wr-log-t">${logTimestamp()}</span>
      <span class="wr-log-lv wr-log-${cls}">${level}</span>
      <span class="wr-log-svc">${svc}</span>
      <span class="wr-log-msg">${escapeHtml(msgFn())}</span>
    </div>`;
  }

  function appendLogLines(el, n) {
    if (!el) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const tmp = document.createElement("div");
      tmp.innerHTML = logLineHtml();
      if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
    }
    el.appendChild(frag);
    while (el.childElementCount > 260) el.firstElementChild.remove();
    el.scrollTop = el.scrollHeight;
  }

  function toNs(ms) {
    try {
      return (BigInt(Math.floor(ms)) * 1000000n).toString();
    } catch (e) {
      return `${Math.floor(ms)}000000`;
    }
  }

  function realLogUrl(startMs, endMs) {
    const q = encodeURIComponent(REAL_LOGS.query);
    return (
      `${REAL_LOGS.base}/api/datasources/proxy/uid/${REAL_LOGS.datasourceUid}` +
      `/loki/api/v1/query_range?query=${q}&start=${toNs(startMs)}&end=${toNs(endMs)}` +
      `&limit=${REAL_LOGS.limit}&direction=backward`
    );
  }

  function gmGetText(url, cb) {
    if (typeof GM_xmlhttpRequest !== "function") {
      cb(new Error("no GM"), "", 0);
      return;
    }
    const token = String(storeGet(STORE.grafanaToken, "") || "").trim();
    const headers = { accept: "application/json", "X-Grafana-Org-Id": String(REAL_LOGS.orgId) };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 20000,
        headers,
        anonymous: token ? true : false,
        onload: (res) => cb(null, res.responseText || "", res.status),
        onerror: () => cb(new Error("network"), "", 0),
        ontimeout: () => cb(new Error("timeout"), "", 0),
      });
    } catch (e) {
      cb(e, "", 0);
    }
  }

  function parseLokiRows(text) {
    const j = JSON.parse(text);
    const result = (j && j.data && j.data.result) || [];
    const rows = [];
    for (const stream of result) {
      const labels = stream.stream || {};
      for (const value of stream.values || []) {
        const ts = Number(value && value[0]);
        if (!Number.isFinite(ts)) continue;
        rows.push({ ts, line: String((value && value[1]) || ""), labels });
      }
    }
    rows.sort((a, b) => a.ts - b.ts);
    return rows;
  }

  function formatLogNs(ts) {
    const d = new Date(Math.floor(ts / 1e6));
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function realLogLevel(line) {
    const m = String(line).match(/\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b/i);
    if (!m) return "INFO";
    const level = m[1].toUpperCase();
    return level === "WARNING" ? "WARN" : level;
  }

  function realLogService(labels) {
    return labels.job || labels.app || labels.service || labels.container || labels.pod || "loki";
  }

  function realLogLineHtml(row) {
    const level = realLogLevel(row.line);
    const cls = level === "FATAL" ? "error" : level === "TRACE" ? "debug" : level.toLowerCase();
    const msg = row.line.replace(/\x1b\[[0-9;]*m/g, "");
    return `<div class="wr-log-line">
      <span class="wr-log-t">${formatLogNs(row.ts)}</span>
      <span class="wr-log-lv wr-log-${cls}">${level}</span>
      <span class="wr-log-svc">${escapeHtml(realLogService(row.labels))}</span>
      <span class="wr-log-msg">${escapeHtml(msg)}</span>
    </div>`;
  }

  function setLogSrc(srcEl, text, cls, title) {
    if (!srcEl) return;
    srcEl.textContent = text;
    srcEl.className = `wr-log-src ${cls || ""}`.trim();
    if (title) srcEl.title = title;
  }

  function restartRealLogs() {
    const v = state.viewer;
    if (v && v.els && v.els.logEl) {
      detachRealLogs(v.els.logEl);
      if (v.logTimer) clearInterval(v.logTimer);
      v.els.logEl.innerHTML = "";
      appendLogLines(v.els.logEl, 120);
      v.logTimer = setInterval(() => {
        if (v.logsOn) appendLogLines(v.els.logEl, 1);
      }, 2200);
      attachRealLogs(v.els.logEl, v.els.logSrc, () => {
        clearInterval(v.logTimer);
        v.logTimer = null;
      });
    }
    if (state.chatLogEl) {
      detachRealLogs(state.chatLogEl);
      if (state.chatLogTimer) clearInterval(state.chatLogTimer);
      state.chatLogEl.innerHTML = "";
      appendLogLines(state.chatLogEl, 120);
      state.chatLogTimer = setInterval(() => appendLogLines(state.chatLogEl, 1), 2200);
      const src = state.ui && state.ui.chat.querySelector("#wr-chatlog-src");
      attachRealLogs(state.chatLogEl, src, () => {
        clearInterval(state.chatLogTimer);
        state.chatLogTimer = null;
      });
    }
  }

  function attachRealLogs(el, srcEl, onFirstSuccess) {
    if (!el) return null;
    detachRealLogs(el);
    const feed = {
      stopped: false,
      timer: null,
      lastTs: 0,
      seen: new Set(),
      first: false,
      retryAt: 0,
      polling: false,
    };
    el.__wrRealFeed = feed;
    setLogSrc(srcEl, "连接中…", "", "正在连接 Grafana");

    if (srcEl && !srcEl.__wrOpenBound) {
      srcEl.__wrOpenBound = true;
      srcEl.style.cursor = "pointer";
      srcEl.addEventListener("click", () => {
        try {
          window.open(`${REAL_LOGS.base}/explore`, "_blank", "noopener");
        } catch (e) {
          /* ignore */
        }
        if (el.__wrRealFeed) el.__wrRealFeed.retryAt = 0;
      });
    }

    const poll = (initial) => {
      if (feed.stopped || feed.polling) return;
      if (!initial && Date.now() < feed.retryAt) return;
      feed.polling = true;
      const now = Date.now();
      const startMs =
        feed.first && feed.lastTs ? Math.floor(feed.lastTs / 1e6) + 1 : now - REAL_LOGS.lookbackSec * 1000;
      gmGetText(realLogUrl(startMs, now), (err, text, status) => {
        feed.polling = false;
        if (feed.stopped) return;
        if (err) {
          if (!feed.warned) {
            feed.warned = true;
            warn("Grafana 日志不可用，使用模拟日志", err.message || err);
          }
          setLogSrc(srcEl, feed.first ? "离线" : "模拟", "", "Grafana 不可用，使用模拟日志");
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        if (status === 401 || status === 403) {
          if (!feed.warned) {
            feed.warned = true;
            warn("Grafana 日志未登录（HTTP " + status + "）");
          }
          setLogSrc(srcEl, "未登录", "err", "点击打开 Grafana 登录");
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        if (status < 200 || status >= 300) {
          if (!feed.warned) {
            feed.warned = true;
            warn("Grafana 日志返回 HTTP " + status);
          }
          setLogSrc(srcEl, feed.first ? "离线" : "模拟", "", `Grafana HTTP ${status}`);
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        let rows;
        try {
          rows = parseLokiRows(text);
        } catch (e) {
          setLogSrc(srcEl, feed.first ? "离线" : "模拟", "", "Grafana 返回无法解析");
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        if (!feed.first) {
          feed.first = true;
          if (typeof onFirstSuccess === "function") onFirstSuccess();
          el.innerHTML = "";
        }
        const frag = document.createDocumentFragment();
        let added = 0;
        for (const row of rows) {
          const key = `${row.ts}|${row.line}`;
          if (feed.seen.has(key)) continue;
          feed.seen.add(key);
          const tmp = document.createElement("div");
          tmp.innerHTML = realLogLineHtml(row);
          if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
          added++;
          if (row.ts > feed.lastTs) feed.lastTs = row.ts;
        }
        if (feed.seen.size > 5000) feed.seen.clear();
        const empty = el.querySelector(".wr-log-empty");
        if (empty) empty.remove();
        if (added) {
          el.appendChild(frag);
          while (el.childElementCount > 400) el.firstElementChild.remove();
          el.scrollTop = el.scrollHeight;
        }
        if (!el.childElementCount) el.innerHTML = '<div class="wr-log-empty">暂无日志</div>';
        feed.warned = false;
        setLogSrc(srcEl, "实时", "live", "Grafana Loki · 点击打开 Explore");
        feed.retryAt = 0;
      });
    };

    poll(true);
    feed.timer = setInterval(() => poll(false), REAL_LOGS.refreshMs);
    return feed;
  }

  function detachRealLogs(el) {
    const feed = el && el.__wrRealFeed;
    if (!feed) return;
    feed.stopped = true;
    clearInterval(feed.timer);
    try {
      el.__wrRealFeed = null;
    } catch (e) {
      /* ignore */
    }
  }

  function startWorkLogs(v) {
    const el = v.els.logEl;
    if (!el) return;
    appendLogLines(el, 150);
    v.logTimer = setInterval(() => {
      if (v.logsOn) appendLogLines(el, 1);
    }, 2200);
    attachRealLogs(el, v.els.logSrc, () => {
      clearInterval(v.logTimer);
      v.logTimer = null;
    });
  }

  function stopChatLogs() {
    if (state.chatLogTimer) clearInterval(state.chatLogTimer);
    state.chatLogTimer = null;
    detachRealLogs(state.chatLogEl);
    state.chatLogEl = null;
  }

  function startChatLogs() {
    stopChatLogs();
    const ui = state.ui;
    if (!ui) return;
    const el = ui.chat.querySelector("#wr-chatlog-body");
    if (!el) return;
    state.chatLogEl = el;
    appendLogLines(el, 160);
    state.chatLogTimer = setInterval(() => appendLogLines(el, 1), 2200);
    attachRealLogs(el, ui.chat.querySelector("#wr-chatlog-src"), () => {
      clearInterval(state.chatLogTimer);
      state.chatLogTimer = null;
    });
  }

  /* ---------- 自建 PDF 阅读器 ---------- */

  function maxLogWidth(v) {
    const bodyW = v && v.els && v.els.body ? v.els.body.clientWidth : 0;
    const base = bodyW > 0 ? bodyW : 900;
    return Math.max(220, base - 60);
  }

  function applyLogWidth(v, w) {
    const width = clamp(Number(w) || 340, 220, maxLogWidth(v));
    if (v && v.els && v.els.logPane) v.els.logPane.style.width = `${width}px`;
    return width;
  }

  function liveResizeViewer() {
    const v = state.viewer;
    if (!v || !v.pages.length || v._liveRaf) return;
    v._liveRaf = requestAnimationFrame(() => {
      v._liveRaf = 0;
      if (state.viewer !== v) return;
      const width = computePageWidth(v);
      for (const p of v.pages) {
        p.el.style.width = `${width}px`;
        if (!p.rendered) p.el.style.height = `${Math.round(width * p.ratio)}px`;
      }
    });
  }

  function computePageWidth(v) {
    const cw = v.els.scroll.clientWidth || 800;
    const base = Math.max(320, Math.min(cw, 1600));
    return Math.max(40, Math.round(base * v.zoom));
  }

  function buildViewerUi() {
    const ui = state.ui;
    state.previewOpen = true;
    ui.preview.hidden = false;
    ui.preview.innerHTML = `<div class="wr-pv">
      ${pvBarHtml(`
        <button class="wr-pv-btn" id="wr-pv-prev" title="上一页">‹</button>
        <span class="wr-pv-pageno"><input id="wr-pv-page-input" value="1" inputmode="numeric"> / <span id="wr-pv-page-count">–</span></span>
        <button class="wr-pv-btn" id="wr-pv-next" title="下一页">›</button>
        <button class="wr-pv-btn" id="wr-pv-zoom-out" title="缩小">−</button>
        <span class="wr-pv-zoom" id="wr-pv-zoom">${Math.round(DEFAULT_ZOOM * 100)}%</span>
        <button class="wr-pv-btn" id="wr-pv-zoom-in" title="放大">+</button>
        <button class="wr-pv-btn" id="wr-pv-fit">适应宽度</button>
        <button class="wr-pv-btn active" id="wr-pv-logs" title="切换日志栏">日志</button>
      `)}
      <div class="wr-pv-body" id="wr-pv-body">
        <div class="wr-pv-main">
          <div class="wr-pv-scroll" id="wr-pv-scroll"><div class="wr-pv-pages" id="wr-pv-pages"></div></div>
          <div class="wr-pv-status" id="wr-pv-status">正在解析文档…</div>
        </div>
        <div class="wr-pv-logresizer" id="wr-pv-logresizer" title="拖动调整日志栏宽度"></div>
        <aside class="wr-pv-logpane" id="wr-pv-logpane">
          <div class="wr-pv-loghead"><span class="wr-pv-dot"></span>运行日志<span class="wr-log-src" id="wr-pv-log-src">模拟</span></div>
          <div class="wr-pv-log" id="wr-pv-log"></div>
        </aside>
      </div>
    </div>`;

    const $ = (sel) => ui.preview.querySelector(sel);
    const v = {
      doc: null,
      pages: [],
      zoom: DEFAULT_ZOOM,
      epoch: 0,
      pageCount: 0,
      current: 1,
      observer: null,
      logTimer: null,
      logsOn: true,
      els: {
        root: $(".wr-pv"),
        body: $("#wr-pv-body"),
        scroll: $("#wr-pv-scroll"),
        pagesEl: $("#wr-pv-pages"),
        logEl: $("#wr-pv-log"),
        logSrc: $("#wr-pv-log-src"),
        logPane: $("#wr-pv-logpane"),
        logResizer: $("#wr-pv-logresizer"),
        status: $("#wr-pv-status"),
        zoomLabel: $("#wr-pv-zoom"),
        pageInput: $("#wr-pv-page-input"),
        pageCount: $("#wr-pv-page-count"),
      },
      destroyed: false,
      sourceUrl: "",
    };
    state.viewer = v;
    state.logWidth = applyLogWidth(v, state.logWidth);
    const pvTitle = $("#wr-pv-title");
    if (pvTitle) pvTitle.addEventListener("click", toggleLogsOnly);
    applyViewerLogsOnly(v);
    bindHorizontalDrag(v.els.logResizer, {
      getWidth: () => v.els.logPane.getBoundingClientRect().width || state.logWidth,
      min: 220,
      max: () => maxLogWidth(v),
      invert: true,
      onMove: (w) => {
        state.logWidth = w;
        v.els.logPane.style.width = `${w}px`;
        liveResizeViewer();
      },
      onEnd: () => {
        storeSet(STORE.logWidth, state.logWidth);
        relayout(v, true);
      },
    });

    const back = $("#wr-pv-back");
    if (back) back.addEventListener("click", hidePreview);
    $("#wr-pv-prev").addEventListener("click", () => jumpToPage(v, v.current - 1));
    $("#wr-pv-next").addEventListener("click", () => jumpToPage(v, v.current + 1));
    $("#wr-pv-zoom-out").addEventListener("click", () => setZoom(v, v.zoom - 0.05));
    $("#wr-pv-zoom-in").addEventListener("click", () => setZoom(v, v.zoom + 0.05));
    $("#wr-pv-fit").addEventListener("click", () => setZoom(v, 1));
    $("#wr-pv-logs").addEventListener("click", (ev) => {
      if (state.logsOnly) {
        toast("点击顶部文件名可切回阅读区");
        return;
      }
      v.logsOn = !v.logsOn;
      v.els.logPane.classList.toggle("hidden", !v.logsOn);
      if (v.els.logResizer) v.els.logResizer.classList.toggle("hidden", !v.logsOn);
      ev.currentTarget.classList.toggle("active", v.logsOn);
      if (v.logsOn) v.els.logEl.scrollTop = v.els.logEl.scrollHeight;
      requestAnimationFrame(() => {
        if (state.viewer === v) relayout(v, true);
      });
    });
    v.els.pageInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        const n = parseInt(v.els.pageInput.value, 10);
        if (n) jumpToPage(v, n);
        v.els.pageInput.blur();
      }
    });

    let ticking = false;
    v.scrollHandler = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateCurrent(v);
        renderVisible(v);
      });
    };
    v.els.scroll.addEventListener("scroll", v.scrollHandler, { passive: true });
    v.resizeHandler = () => {
      clearTimeout(v._resizeTimer);
      v._resizeTimer = setTimeout(() => {
        if (state.viewer !== v) return;
        state.logWidth = applyLogWidth(v, state.logWidth);
        relayout(v, true);
      }, 160);
    };
    window.addEventListener("resize", v.resizeHandler);

    startWorkLogs(v);
    return v;
  }

  function buildPages(v) {
    const { pagesEl, pageCount, status } = v.els;
    pagesEl.innerHTML = "";
    v.pages = [];
    pageCount.textContent = String(v.pageCount);
    const width = computePageWidth(v);
    for (let i = 1; i <= v.pageCount; i++) {
      const el = document.createElement("div");
      el.className = "wr-pv-page";
      el.dataset.page = String(i);
      el.style.width = `${width}px`;
      el.style.height = `${Math.round(width * 1.414)}px`;
      el.innerHTML = `<div class="wr-pv-page-ph">${i}</div>`;
      pagesEl.appendChild(el);
      v.pages.push({ num: i, el, rendered: false, rendering: false, ratio: 1.414 });
    }
    if (typeof W.IntersectionObserver === "function") {
      v.observer = new W.IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const p = v.pages[Number(en.target.dataset.page) - 1];
            if (p) renderPage(v, p);
          }
        },
        { root: v.els.scroll, rootMargin: "800px 0px" },
      );
      v.pages.forEach((p) => v.observer.observe(p.el));
    }
    if (status) status.style.display = "none";
  }

  function renderPage(v, p) {
    if (!v || state.viewer !== v || !v.doc || p.rendered || p.rendering) return;
    p.rendering = true;
    const epoch = v.epoch;
    const width = computePageWidth(v);
    v.doc
      .getPage(p.num)
      .then((page) => {
        const base = page.getViewport({ scale: 1 });
        p.ratio = base.height / base.width;
        p.el.style.height = `${Math.round(width * p.ratio)}px`;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (width / base.width) * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法创建画布");
        return page.render({ canvasContext: ctx, viewport: vp, intent: "display" }).promise.then(() => {
          if (!v || state.viewer !== v || epoch !== v.epoch) return;
          p.el.innerHTML = "";
          p.el.appendChild(canvas);
          p.el.style.height = "auto";
          p.rendered = true;
          p.renderedHeight = Math.round(width * p.ratio);
        });
      })
      .catch(() => {
        if (v && state.viewer === v) {
          p.el.innerHTML = `<div class="wr-pv-page-err">第 ${p.num} 页渲染失败</div>`;
        }
      })
      .finally(() => {
        p.rendering = false;
      });
  }

  function renderVisible(v) {
    if (!v || !v.doc) return;
    const sc = v.els.scroll;
    const top = sc.scrollTop;
    const bottom = top + (sc.clientHeight || 800);
    const margin = 900;
    const keep = 2600;
    const width = computePageWidth(v);
    for (const p of v.pages) {
      const pt = p.el.offsetTop;
      const ph = p.el.offsetHeight || 1;
      const near = pt < bottom + margin && pt + ph > top - margin;
      if (near) {
        renderPage(v, p);
      } else if (p.rendered && (pt + ph < top - keep || pt > bottom + keep)) {
        p.el.innerHTML = `<div class="wr-pv-page-ph">${p.num}</div>`;
        p.el.style.height = `${p.renderedHeight || Math.round(width * p.ratio)}px`;
        p.rendered = false;
      }
    }
  }

  function updateCurrent(v) {
    if (!v || !v.pages.length) return;
    const sc = v.els.scroll;
    const threshold = sc.scrollTop + Math.min(160, (sc.clientHeight || 600) * 0.3);
    let cur = 1;
    for (const p of v.pages) {
      if (p.el.offsetTop <= threshold) cur = p.num;
      else break;
    }
    if (cur !== v.current) {
      v.current = cur;
      if (document.activeElement !== v.els.pageInput) v.els.pageInput.value = String(cur);
    }
  }

  function relayout(v, clearRendered) {
    if (!v || state.viewer !== v) return;
    v.epoch++;
    const width = computePageWidth(v);
    v.els.zoomLabel.textContent = `${Math.round(v.zoom * 100)}%`;
    for (const p of v.pages) {
      p.el.style.width = `${width}px`;
      if (clearRendered && p.rendered) {
        p.el.innerHTML = `<div class="wr-pv-page-ph">${p.num}</div>`;
        p.rendered = false;
      }
      if (!p.rendered) p.el.style.height = `${Math.round(width * p.ratio)}px`;
    }
    if (clearRendered) {
      requestAnimationFrame(() => {
        if (state.viewer === v) {
          jumpToPage(v, v.current);
          renderVisible(v);
        }
      });
    }
  }

  function setZoom(v, next) {
    if (!v) return;
    const z = Math.max(0.1, Math.min(2, Math.round(next * 100) / 100));
    if (z === v.zoom) return;
    v.zoom = z;
    relayout(v, true);
  }

  function jumpToPage(v, n) {
    if (!v || !v.pages.length) return;
    const num = Math.max(1, Math.min(v.pageCount || 1, Math.floor(Number(n) || 1)));
    const p = v.pages[num - 1];
    if (!p) return;
    const sc = v.els.scroll;
    const top = p.el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTop = Math.max(0, top - 12);
    v.current = num;
    if (document.activeElement !== v.els.pageInput) v.els.pageInput.value = String(num);
    renderVisible(v);
    updateCurrent(v);
  }

  function destroyViewer() {
    const v = state.viewer;
    if (!v) return;
    state.viewer = null;
    v.destroyed = true;
    try {
      if (v.observer) v.observer.disconnect();
    } catch (e) {
      /* ignore */
    }
    try {
      clearInterval(v.logTimer);
    } catch (e) {
      /* ignore */
    }
    try {
      if (v.els && v.els.logEl) detachRealLogs(v.els.logEl);
    } catch (e) {
      /* ignore */
    }
    try {
      if (v.resizeHandler) window.removeEventListener("resize", v.resizeHandler);
    } catch (e) {
      /* ignore */
    }
    try {
      if (v.epubNavTimer) clearTimeout(v.epubNavTimer);
    } catch (e) {
      /* ignore */
    }
    try {
      if (v.scrollHandler && v.els && v.els.scroll)
        v.els.scroll.removeEventListener("scroll", v.scrollHandler);
    } catch (e) {
      /* ignore */
    }
    try {
      if (v.doc) {
        const p = v.doc.destroy();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch (e) {
      /* ignore */
    }
  }

  async function showPdfViewer(buf, sourceUrl, token) {
    const v = buildViewerUi();
    v.sourceUrl = sourceUrl;
    try {
      const doc = await openPdfDocument(buf);
      if (token !== state.previewToken || state.viewer !== v) {
        try {
          const p = doc.destroy();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (e) {
          /* ignore */
        }
        return;
      }
      v.doc = doc;
      v.pageCount = doc.numPages;
      if (!v.pageCount) throw new Error("文档没有可显示的页面");
      buildPages(v);
      relayout(v, false);
      requestAnimationFrame(() => {
        if (state.viewer === v) {
          updateCurrent(v);
          renderVisible(v);
        }
      });
    } catch (e) {
      if (state.viewer === v) destroyViewer();
      throw e;
    }
  }

  async function openPreview() {
    if (!state.ui || !state.ctx) return;
    if (state.ctx.bookType === "epub") {
      try {
        await openEpubPreview();
      } catch (e) {
        destroyViewer();
        showPreviewError(`EPUB 加载失败：${e && e.message ? e.message : e}`, "");
      }
      return;
    }
    const token = ++state.previewToken;
    destroyViewer();
    showPreviewLoading("正在获取文档…");
    const url = await resolvePdfUrl();
    if (token !== state.previewToken) return;
    if (!url) {
      showPreviewError("没有拿到 PDF 地址，请点「重新获取」或回官方阅读器打开一次", "");
      return;
    }

    showPreviewLoading("正在下载文档…");
    try {
      const buf = await downloadPdfBytes(url, (loaded, total) => {
        if (token !== state.previewToken) return;
        const pct = total ? Math.floor((loaded / total) * 100) : null;
        setPreviewStatus(pct == null ? "正在下载文档…" : `正在下载文档 ${pct}%`);
      });
      if (token !== state.previewToken) return;
      showPreviewLoading("正在解析文档…");
      await showPdfViewer(buf, url, token);
    } catch (e) {
      if (token !== state.previewToken) return;
      destroyViewer();
      showPreviewError(`文档加载失败：${e && e.message ? e.message : e}`, url);
    }
  }

  /* ============================== EPUB 阅读器 ============================== */

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function readOfficialToc() {
    const nodes = [...document.querySelectorAll(".readerCatalog_list_item")];
    return nodes
      .map((el, index) => {
        const titleEl = el.querySelector(".readerCatalog_list_item_title_text");
        const levelEl = el.querySelector('[class*="readerCatalog_list_item_level_"]');
        let level = 1;
        if (levelEl) {
          const m = String(levelEl.className).match(/level_(\d+)/);
          if (m) level = Number(m[1]) || 1;
        }
        const title = (titleEl ? titleEl.textContent : el.textContent || "").replace(/\s+/g, " ").trim();
        return title ? { index, title, level, el } : null;
      })
      .filter(Boolean);
  }

  async function readOfficialTocReady() {
    let items = readOfficialToc();
    if (items.length) return items;
    const btn =
      document.querySelector(".rbb_item.catalog") || document.querySelector(".readerControls_item.catalog");
    if (btn) {
      try {
        btn.click();
      } catch (e) {
        /* ignore */
      }
    }
    for (let i = 0; i < 12 && !items.length; i++) {
      await delay(250);
      items = readOfficialToc();
    }
    return items;
  }

  function officialCatalogVisible() {
    const el = document.querySelector(".readerCatalog");
    if (!el) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
    } catch (e) {
      /* ignore */
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    return readOfficialToc().length > 0;
  }

  async function ensureOfficialCatalogOpen() {
    if (officialCatalogVisible()) return true;
    const btn =
      document.querySelector(".rbb_item.catalog") || document.querySelector(".readerControls_item.catalog");
    if (btn) {
      try {
        btn.click();
      } catch (e) {
        /* ignore */
      }
    }
    for (let i = 0; i < 10; i++) {
      await delay(150);
      if (officialCatalogVisible() || readOfficialToc().length) return true;
    }
    return readOfficialToc().length > 0;
  }

  function currentReaderChapterTitle() {
    const el = document.querySelector(".readerTopBar_title_chapter");
    return el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function findTocIndex(items, title) {
    const needle = String(title || "").trim();
    if (!needle) return -1;
    return items.findIndex((item) => item.title === needle);
  }

  function clickOfficialTocItem(item) {
    if (!item || !item.el) return;
    const inner = item.el.querySelector(".readerCatalog_list_item_inner");
    try {
      (inner || item.el).click();
    } catch (e) {
      /* ignore */
    }
  }

  function showEpubStatus(v, text) {
    if (!v || !v.els || !v.els.status) return;
    v.els.status.style.display = "flex";
    v.els.status.textContent = text || "正在加载章节…";
  }

  function hideEpubStatus(v) {
    if (v && v.els && v.els.status) v.els.status.style.display = "none";
  }

  function renderEpubToc(v) {
    if (!v || !v.els || !v.els.tocList) return;
    v.els.tocList.innerHTML = v.toc
      .map((item) => {
        const active = item.index === v.currentIndex ? " active" : "";
        const level = item.level > 1 ? ` level${Math.min(item.level, 3)}` : "";
        return `<div class="wr-epub-toc-item${level}${active}" data-index="${item.index}">${escapeHtml(
          item.title,
        )}</div>`;
      })
      .join("");
  }

  function renderEpubChapter(v, key, title) {
    if (!v || state.viewer !== v) return;
    let html = chapterHtmlFor(key);
    const css = chapterCssFor(key);
    if (!html) {
      const fallback = document.querySelector(".readerChapterContent");
      if (fallback) html = fallback.innerHTML || "";
    }
    if (!html) {
      showEpubStatus(v, "没有拿到章节内容，请重试");
      return;
    }

    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll("script,iframe,object,embed").forEach((node) => node.remove());
    parsed.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      }
    });
    parsed.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!/^https?:/i.test(href)) a.removeAttribute("href");
    });

    const bodyHtml = parsed.body ? parsed.body.innerHTML : html;
    const host = v.els.page;
    let sr = host.shadowRoot;
    if (!sr) sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = `${css}
:host { display: block; }
.wr-epub-content { font: 17px/1.9 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #222; word-wrap: break-word; }
.wr-epub-content p { margin: 0 0 1.05em; line-height: 1.9; }
.wr-epub-content .section { text-indent: 2em; }
.wr-epub-content h1, .wr-epub-content h2, .wr-epub-content h3 { line-height: 1.4; margin: 1.4em 0 .7em; }
.wr-epub-content img { max-width: 100%; height: auto; }
.wr-epub-content a { color: #576b95; text-decoration: none; }
.wr-epub-content table { border-collapse: collapse; max-width: 100%; }
.wr-epub-content .calibre5 { margin: 1.2em auto; }
`;
    sr.appendChild(style);
    const wrap = document.createElement("div");
    wrap.className = `wr-epub-content ${parsed.body ? parsed.body.className : ""}`;
    wrap.innerHTML = bodyHtml;
    sr.appendChild(wrap);

    v.currentTitle = title || currentReaderChapterTitle();
    if (v.els.chapterTitle) v.els.chapterTitle.textContent = v.currentTitle;
    const idx = findTocIndex(v.toc, v.currentTitle);
    if (idx >= 0) v.currentIndex = idx;
    renderEpubToc(v);
    hideEpubStatus(v);
    if (v.els.scroll) v.els.scroll.scrollTop = 0;
  }

  function waitForEpubChapter(v, startAt, targetTitle, onDone) {
    const token = v.navToken;
    const check = () => {
      if (state.viewer !== v || v.navToken !== token) return;
      const currentTitle = currentReaderChapterTitle();
      const key =
        chapterKeyForTitle(targetTitle) ||
        (currentTitle ? chapterKeyForTitle(currentTitle) : "") ||
        (state.epubLastAt > startAt - 500 ? state.epubLastKey : "");
      if (key && chapterHtmlFor(key)) {
        renderEpubChapter(v, key, currentTitle || targetTitle || "");
        if (typeof onDone === "function") onDone();
        return;
      }
      if (Date.now() - startAt > 12000) {
        const fallback = document.querySelector(".readerChapterContent");
        if (fallback) {
          renderEpubChapter(v, "", targetTitle);
          return;
        }
        showEpubStatus(v, "章节加载超时，请重试");
        return;
      }
      v.epubNavTimer = setTimeout(check, 250);
    };
    check();
  }

  async function loadEpubChapterByIndex(v, index) {
    if (!v || !v.toc) return;
    const target = v.toc[index];
    if (!target) return;
    const targetTitle = target.title;
    v.navToken++;
    const token = v.navToken;
    const startAt = Date.now();
    showEpubStatus(v, "正在加载章节…");

    await ensureOfficialCatalogOpen();
    if (token !== v.navToken || state.viewer !== v) return;

    let items = readOfficialToc();
    if (!items.length) {
      const btn =
        document.querySelector(".rbb_item.catalog") || document.querySelector(".readerControls_item.catalog");
      if (btn) btn.click();
      await delay(250);
      items = readOfficialToc();
    }
    if (token !== v.navToken || state.viewer !== v) return;

    const item = items.find((it) => it.title === targetTitle) || items[index];
    if (!item) {
      showEpubStatus(v, "没有找到该章节，请重试");
      return;
    }
    clickOfficialTocItem(item);
    waitForEpubChapter(v, startAt, targetTitle, () => {
      v.currentIndex = index;
      renderEpubToc(v);
    });
  }

  function buildEpubViewerUi() {
    const ui = state.ui;
    state.previewOpen = true;
    ui.preview.hidden = false;
    ui.preview.innerHTML = `<div class="wr-pv wr-epub-viewer">
      ${pvBarHtml(`
        <button class="wr-pv-btn" id="epub-prev" title="上一节">上一章</button>
        <span class="wr-epub-chapter" id="epub-chapter-title"></span>
        <button class="wr-pv-btn" id="epub-next" title="下一节">下一章</button>
        <button class="wr-pv-btn" id="epub-toc-btn" title="目录">目录</button>
        <button class="wr-pv-btn active" id="wr-pv-logs" title="切换日志栏">日志</button>
      `)}
      <div class="wr-pv-body" id="wr-pv-body">
        <div class="wr-pv-main">
          <div class="wr-epub-scroll" id="wr-epub-scroll">
            <article class="wr-epub-page" id="wr-epub-page"></article>
          </div>
          <div class="wr-pv-status" id="wr-pv-status">正在加载章节…</div>
          <div class="wr-epub-toc hidden" id="wr-epub-toc">
            <div class="wr-epub-toc-head"><span>目录</span><button id="epub-toc-close" title="关闭">×</button></div>
            <div class="wr-epub-toc-list" id="wr-epub-toc-list"></div>
          </div>
        </div>
        <div class="wr-pv-logresizer" id="wr-pv-logresizer" title="拖动调整日志栏宽度"></div>
        <aside class="wr-pv-logpane" id="wr-pv-logpane">
          <div class="wr-pv-loghead"><span class="wr-pv-dot"></span>运行日志<span class="wr-log-src" id="wr-pv-log-src">模拟</span></div>
          <div class="wr-pv-log" id="wr-pv-log"></div>
        </aside>
      </div>
    </div>`;

    const $ = (sel) => ui.preview.querySelector(sel);
    const v = {
      kind: "epub",
      root: $(".wr-pv"),
      toc: [],
      currentIndex: -1,
      currentTitle: "",
      navToken: 0,
      epubNavTimer: null,
      logsOn: true,
      logTimer: null,
      els: {
        root: $(".wr-pv"),
        body: $("#wr-pv-body"),
        scroll: $("#wr-epub-scroll"),
        page: $("#wr-epub-page"),
        status: $("#wr-pv-status"),
        chapterTitle: $("#epub-chapter-title"),
        toc: $("#wr-epub-toc"),
        tocList: $("#wr-epub-toc-list"),
        logEl: $("#wr-pv-log"),
        logSrc: $("#wr-pv-log-src"),
        logPane: $("#wr-pv-logpane"),
        logResizer: $("#wr-pv-logresizer"),
      },
    };
    state.viewer = v;
    state.logWidth = applyLogWidth(v, state.logWidth);

    const back = $("#wr-pv-back");
    if (back) back.addEventListener("click", hidePreview);
    const pvTitle = $("#wr-pv-title");
    if (pvTitle) pvTitle.addEventListener("click", toggleLogsOnly);

    $("#epub-prev").addEventListener("click", () => {
      const next = Math.max(0, (v.currentIndex >= 0 ? v.currentIndex : 0) - 1);
      loadEpubChapterByIndex(v, next);
    });
    $("#epub-next").addEventListener("click", () => {
      const next = Math.min(v.toc.length - 1, (v.currentIndex >= 0 ? v.currentIndex : 0) + 1);
      loadEpubChapterByIndex(v, next);
    });
    $("#epub-toc-btn").addEventListener("click", () => {
      v.els.toc.classList.toggle("hidden");
    });
    $("#epub-toc-close").addEventListener("click", () => v.els.toc.classList.add("hidden"));
    v.els.tocList.addEventListener("click", (ev) => {
      const item = ev.target.closest(".wr-epub-toc-item");
      if (!item) return;
      const index = Number(item.getAttribute("data-index"));
      v.els.toc.classList.add("hidden");
      loadEpubChapterByIndex(v, index);
    });
    $("#wr-pv-logs").addEventListener("click", (ev) => {
      if (state.logsOnly) {
        toast("点击顶部文件名可切回阅读区");
        return;
      }
      v.logsOn = !v.logsOn;
      v.els.logPane.classList.toggle("hidden", !v.logsOn);
      if (v.els.logResizer) v.els.logResizer.classList.toggle("hidden", !v.logsOn);
      ev.currentTarget.classList.toggle("active", v.logsOn);
      if (v.logsOn) v.els.logEl.scrollTop = v.els.logEl.scrollHeight;
    });

    bindHorizontalDrag(v.els.logResizer, {
      getWidth: () => v.els.logPane.getBoundingClientRect().width || state.logWidth,
      min: 220,
      max: () => maxLogWidth(v),
      invert: true,
      onMove: (w) => {
        state.logWidth = w;
        v.els.logPane.style.width = `${w}px`;
      },
      onEnd: () => storeSet(STORE.logWidth, state.logWidth),
    });

    v.resizeHandler = () => {
      clearTimeout(v._resizeTimer);
      v._resizeTimer = setTimeout(() => {
        if (state.viewer !== v) return;
        state.logWidth = applyLogWidth(v, state.logWidth);
      }, 160);
    };
    window.addEventListener("resize", v.resizeHandler);

    startWorkLogs(v);
    return v;
  }

  async function openEpubPreview() {
    const token = ++state.previewToken;
    destroyViewer();
    showPreviewLoading("正在加载章节…");
    await ensureOfficialCatalogOpen();
    const toc = await readOfficialTocReady();
    if (token !== state.previewToken) return;
    if (!toc.length) {
      showPreviewError("没有读到目录，请回官方阅读器打开一次", "");
      return;
    }
    const v = buildEpubViewerUi();
    v.toc = toc;
    const title = currentReaderChapterTitle() || (toc[0] && toc[0].title) || "";
    v.currentIndex = findTocIndex(v.toc, title);
    v.currentTitle = title;
    if (v.els.chapterTitle) v.els.chapterTitle.textContent = title;
    renderEpubToc(v);

    const key = chapterKeyForTitle(title) || state.epubLastKey;
    if (key && chapterHtmlFor(key)) {
      renderEpubChapter(v, key, title);
    } else {
      loadEpubChapterByIndex(v, v.currentIndex >= 0 ? v.currentIndex : 0);
    }
  }

  function hidePreview() {
    state.previewToken++;
    destroyViewer();
    const ui = state.ui;
    state.previewOpen = false;
    state.previewUrl = "";
    if (ui) {
      ui.preview.hidden = true;
      ui.preview.innerHTML = "";
    }
    if (state.logsOnly) renderChat();
  }

  /* ============================== 进入 / 退出 ============================== */

  function applyViewport() {
    if (!state.ui || !state.ctx) return;
    const narrow = window.innerWidth < MIN_WIDTH;
    if (!state.enabled) return;
    if (narrow) {
      state.ui.shell.style.display = "none";
      hideOfficial(false);
    } else {
      state.ui.shell.style.display = "flex";
      hideOfficial(true);
    }
  }

  function enterMode() {
    state.enabled = true;
    storeSet(STORE.enabled, true);
    ensureRoot();
    if (!state.ui) return;
    state.ui.shell.style.display = "flex";
    state.ui.ball.hidden = true;
    renderAll();
    updateDocumentTitle();
    applyViewport();
    loadShelf();
  }

  function exitMode() {
    state.enabled = false;
    storeSet(STORE.enabled, false);
    hidePreview();
    stopChatLogs();
    restoreDocumentTitle();
    hideOfficial(false);
    if (state.ui) {
      state.ui.shell.style.display = "none";
      state.ui.ball.hidden = false;
    }
    toast("已退出微信模式");
  }

  function mount(ctx) {
    state.ctx = ctx;
    if (!document.title.includes("工作目录")) state.originalTitle = document.title;
    rememberBook(ctx);
    ensureRoot();
    if (!state.ui) return;

    if (!state.enabled) {
      state.ui.shell.style.display = "none";
      state.ui.ball.hidden = false;
      hideOfficial(false);
      return;
    }

    state.ui.shell.style.display = "flex";
    state.ui.ball.hidden = true;
    renderAll();
    updateDocumentTitle();
    applyViewport();
    loadShelf();
    log(
      `已接管 ${ctx.bookType === "epub" ? "EPUB" : "PDF"} 书《${ctx.title}》${ctx.cbBookId ? ` · ${ctx.cbBookId}` : ""}`,
    );
  }

  function teardown() {
    state.bootToken++;
    restoreDocumentTitle();
    stopChatLogs();
    state.ctx = null;
    state.shelf = [];
    state.shelfLoading = false;
    state.shelfLoaded = false;
    hidePreview();
    if (state.ui) {
      state.ui.host.remove();
      state.ui = null;
    }
    document.removeEventListener("keydown", onKeydown);
    hideOfficial(false);
  }

  /* ============================== 启动 ============================== */

  async function boot() {
    if (!isReaderPage()) return;
    const token = ++state.bootToken;
    const ctx = await waitForPdf(DETECT_TIMEOUT);
    if (token !== state.bootToken) return;
    if (!ctx) {
      log("未检测到 PDF / EPUB 管线，保持官方界面");
      return;
    }
    mount(ctx);
  }

  let lastReaderInfoId = isReaderPage() ? readerInfoBase(pathInfoId()) : "";

  function watchRoute() {
    setInterval(() => {
      if (!isReaderPage()) {
        if (state.ui || state.ctx) teardown();
        lastReaderInfoId = "";
        return;
      }
      const id = readerInfoBase(pathInfoId());
      if (id && id !== lastReaderInfoId) {
        lastReaderInfoId = id;
        teardown();
        safeBoot();
      }
    }, 1000);
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== "function") return;
    try {
      GM_registerMenuCommand("进入/退出微信模式", () => {
        if (state.enabled && state.ui) exitMode();
        else if (state.ctx) enterMode();
        else safeBoot();
      });
      GM_registerMenuCommand("刷新书架", () => {
        state.shelf = [];
        loadShelf(true);
        toast("正在刷新书架…");
      });
      GM_registerMenuCommand("设置 Grafana Token", () => {
        const next = window.prompt("粘贴 Grafana Service Account Token（留空 = 使用浏览器登录态）", "");
        if (next === null) return;
        storeSet(STORE.grafanaToken, String(next).trim());
        restartRealLogs();
        toast("Grafana Token 已保存");
      });
      GM_registerMenuCommand("清除 Grafana Token", () => {
        storeSet(STORE.grafanaToken, "");
        restartRealLogs();
        toast("已清除 Grafana Token");
      });
    } catch (e) {
      /* ignore */
    }
  }

  function safeBoot() {
    boot().catch((e) => warn("启动失败", e));
  }

  installSignalHooks();
  injectBaseStyle();
  watchRoute();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeBoot, { once: true });
  } else {
    safeBoot();
  }

  registerMenu();

  W.__WR_CHAT_MODE__ = {
    version: VERSION,
    get ctx() {
      return state.ctx;
    },
    detect: detectBook,
    get epub() {
      return {
        lastKey: state.epubLastKey,
        lastAt: state.epubLastAt,
        viewer: state.viewer ? state.viewer.kind || "pdf" : null,
        chunks: [...state.epubChunks.entries()].map(([c, set]) => ({
          c,
          html: set.html.size,
          css: set.css.size,
          at: set.at,
        })),
      };
    },
    enter: enterMode,
    exit: exitMode,
    refreshShelf: () => {
      state.shelf = [];
      state.shelfLoaded = false;
      loadShelf(true);
    },
  };

  log(`v${VERSION} 已启动`);
})();
