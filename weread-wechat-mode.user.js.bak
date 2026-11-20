// ==UserScript==
// @name         寰俊璇讳功路寰俊妯″紡
// @namespace    weread-wechat-mode
// @version      0.6.2
// @description  M4锛氬井淇¤涔� PDF 闃呰鍣� + Grafana 鐪熷疄鏃ュ織 + IDE 宸ヤ綔鐩綍浼銆�
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
 * M4 鑼冨洿锛�
 *   - 鍙湪 /web/reader/* 涓旀娴嬪埌 PDF 绠＄嚎鏃舵帴绠★紙pdfUrl / fm=pdf / /cos/download / PDF DOM锛�
 *   - 宸︽爮锛氭湰鍦拌褰曡繃鐨� PDF 涔� + 涔︽灦鎺ュ彛閲岃兘纭鏄� PDF 鐨勪功
 *   - 鐐瑰乏鏍忊€滃井淇¤涔︹€濆洓涓瓧鍒囨崲鈥滃伐浣滅洰褰曗€濅吉瑁咃細鏂囦欢鏍戙€佸伐浣滄枃妗ｅ悕銆佹爣绛鹃〉鏍囬
 *   - 鍙虫爮锛氬井淇″紡鏂囦欢娑堟伅鍗＄墖锛岀偣鍑诲悗鍙� PDF 瀛楄妭锛岀敤 PDF.js 鑷缓闃呰鍣ㄦ覆鏌�
 *   - PDF 鍖哄煙鐧藉簳璐磋竟銆侀〉闈㈠眳涓紱鍙充晶鍥哄畾鈥滆繍琛屾棩蹇椻€濇爮锛岄摵婊￠珮搴︼紝鍙敹璧�
 *   - 涓嶅仛锛氭钀芥皵娉°€佸垝绾�/鎯虫硶/璇勮銆佸瓧鍙风缉鏀俱€佹殫榛戞ā寮忋€佸乏鍙虫爮鎷栨嫿
 *
 * 闅愮锛�
 *   - PDF 瀛楄妭閫氳繃 GM_xmlhttpRequest 涓嬭浇锛園connect *锛夛紝鍙姹傝剼鏈В鏋愬嚭鐨勭鍚嶅湴鍧€
 *   - 鐪熷疄鏃ュ織鏌ヨ鍙戝線 igfa.dcgstd.cn锛堜娇鐢ㄤ綘娴忚鍣ㄩ噷鐨� Grafana 鐧诲綍鎬侊級锛屾煡璇㈣鍙ュ浐瀹�
 *   - 妯℃嫙鏃ュ織涓庡伐浣滅洰褰曚负鏈湴鐢熸垚锛涙墍鏈夋棩蹇楀彧鏄剧ず鍦ㄦ湰鍦帮紝涓嶄笂浼�
 *   - 涓嶈褰� Cookie锛屼笉涓婁紶缁熻鏁版嵁
 *
 * 宸茬煡椋庨櫓锛�
 *   - 绛惧悕 PDF 鍦板潃鍙兘杩囨湡锛岄瑙堝墠浼氶噸鏂拌幏鍙�
 *   - PDF 闇€瑕佹暣浠戒笅杞藉悗鎵嶈兘棰勮锛屽ぇ鏂囦欢棣栨鎵撳紑杈冩參
 *   - PDF.js 閫氳繃 CDN @require锛沺df.worker 涔熶竴骞� @require 骞朵紭鍏堣蛋涓荤嚎绋� worker锛岀粫寮€绔欑偣 CSP
 *   - 鑻ヤ富绾跨▼ worker 涓嶅彲鐢紝鍐嶄緷娆″皾璇� CDN Worker / Blob Worker / 杩愯鏃舵敞鍏�
 *   - 涔︽灦鎺ュ彛瀛楁鏈煡锛孭DF 杩囨护鏈夊厹搴曪紱褰撳墠涔﹀缁堜細鍑虹幇鍦ㄥ乏鏍�
 */

(() => {
  "use strict";

  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  if (W.__WR_CHAT_MODE_INSTALLED__) return;
  W.__WR_CHAT_MODE_INSTALLED__ = true;

  const VERSION = "0.6.2";
  const LOG_PREFIX = "[寰俊璇讳功路寰俊妯″紡]";
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
    logWidth: clamp(Number(storeGet(STORE.logWidth, 340)) || 340, 220, 640),
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

  /* ============================== 宸ュ叿 ============================== */

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
      warn("瀛樺偍澶辫触", key, e);
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
    if (diff < 60 * 1000) return "鍒氬垰";
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 鍒嗛挓鍓峘;
    if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 灏忔椂鍓峘;
    if (diff < 48 * 3600 * 1000) return "鏄ㄥぉ";
    const d = new Date(ms);
    return `${d.getMonth() + 1}鏈�${d.getDate()}鏃;
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

  function docTitle() {
    const t = String(document.title || "")
      .replace(/\s*-\s*寰俊璇讳功\s*$/, "")
      .trim();
    return t && t !== "寰俊璇讳功" ? t : "";
  }

  function readerState() {
    try {
      const s = W.__INITIAL_STATE__;
      return s && s.reader ? s.reader : null;
    } catch (e) {
      return null;
    }
  }

  // 闃呰椤� infoId 閲屽彲瑙ｅ嚭瀵煎叆涔� bookId锛屼緥濡� ... => CB_6DR0M50OA0vl77l75iAQjBlh
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

  /* ============================== 寰俊璇讳功璇锋眰淇″彿 ============================== */

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
        warn("fetch 閽╁瓙瀹夎澶辫触", e);
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
        warn("XHR 閽╁瓙瀹夎澶辫触", e);
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

  /* ============================== EPUB 绔犺妭鍒嗙墖 ============================== */

  const EPUB_CHUNK_RE = /\/web\/book\/chapter\/e_(\d+)/;

  function decodeChapterChunk(raw) {
    const str = String(raw || "").trim();
    if (!str || str.length < 40) return "";
    const offsets = [33, 32];
    for (const off of offsets) {
      try {
        const b64 = str.slice(off);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64.slice(0, 120))) continue;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const out = new TextDecoder("utf-8").decode(bytes);
        if (out && !out.includes("锟�")) return out;
      } catch (e) {
        /* try next offset */
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

  /* ============================== PDF 妫€娴� ============================== */

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
      lastReadAt: Date.now(),
    };
  }

  function waitForPdf(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const ctx = detectPdf();
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

  /* ============================== 鏈湴涔﹀崟 ============================== */

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
      title: b.title || "鏈懡鍚�",
      author: b.author || "",
      cover: b.cover || "",
      bookId: b.bookId || "",
      infoId: b.infoId || "",
      cbBookId: b.cbBookId || "",
      readerUrl: b.readerUrl || "",
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

  /* ============================== 涔︽灦鎺ュ彛 ============================== */

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
      log(`涔︽灦锛氬叡瑙ｆ瀽 ${state.shelf.length} 鏈彲纭鐨� PDF 涔);
      renderSidebar();
    } catch (e) {
      state.shelfLoaded = false;
      warn("涔︽灦鎺ュ彛涓嶅彲鐢紝浠呬娇鐢ㄦ湰鍦拌褰�", e && e.message ? e.message : e);
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
        log("涔︽灦棣栨潯瀛楁", Object.keys(arr[0]).join(","));
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
        if (!isPdf || !title) return null;
        return {
          key: bookId || infoId || title || `shelf-${i}`,
          title,
          author: b.author || "",
          cover: b.cover || b.coverUrl || "",
          bookId,
          infoId,
          cbBookId: /^CB_/.test(bookId) ? bookId : "",
          readerUrl,
          lastReadAt: toMs(b.readUpdateTime ?? b.updateTime ?? b.lastReadTime ?? b.finishTime ?? 0),
          disabled: !readerUrl,
          source: "shelf",
        };
      })
      .filter(Boolean);
  }

  /* ============================== 宸ヤ綔鐩綍浼 ============================== */

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
    return state.workMode ? WORK_DOC_NAME : `${(state.ctx && state.ctx.title) || "鏂囨。"}.pdf`;
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
    const [label, cls] = map[ext] || ["路", "txt"];
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
            <span class="wr-caret">${open ? "鈻�" : "鈻�"}</span><span class="wr-node-name">${escapeHtml(node.name)}</span>
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
      if (state.workMode) document.title = `${WORK_DOC_NAME} 路 宸ヤ綔鐩綍`;
      else if (state.originalTitle) document.title = state.originalTitle;
      else if (state.ctx) document.title = `${state.ctx.title} - 寰俊璇讳功`;
    } catch (e) {
      /* ignore */
    }
  }

  function restoreDocumentTitle() {
    try {
      applyWorkFavicon(false);
      if (state.originalTitle) document.title = state.originalTitle;
      else if (state.ctx) document.title = `${state.ctx.title} - 寰俊璇讳功`;
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
    } else {
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

  /* ============================== 瀹樻柟鐣岄潰闅愯棌 ============================== */

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
            <span class="wr-side-title" id="wr-side-title" title="鍒囨崲涔︾睄 / 宸ヤ綔鐩綍">寰俊璇讳功</span>
            <button class="wr-refresh" id="refresh" title="鍒锋柊涔︽灦">鈫�</button>
          </div>
          <div class="wr-list" id="list"></div>
          <div class="wr-side-foot" id="wr-side-foot">浠呮樉绀烘敮鎸� PDF 闃呰鐨勪功</div>
        </aside>
        <div class="wr-resizer" id="wr-resizer-left" title="鎷栧姩璋冩暣瀹藉害"></div>
        <main class="wr-main" id="main">
          <div class="wr-head" id="head"></div>
          <div class="wr-chat" id="chat"></div>
          <div class="wr-preview" id="preview" hidden></div>
        </main>
      </div>
      <div class="wr-ball" id="ball" hidden>寰�</div>
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
      toast("姝ｅ湪鍒锋柊涔︽灦鈥�");
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
        toast("璇峰厛鍦ㄥ畼鏂逛功鏋舵墦寮€涓€娆¤繖鏈功锛屼箣鍚庝細鍑虹幇鍦ㄨ繖閲�");
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
      ui.sideTitle.textContent = "宸ヤ綔鐩綍";
      ui.sideFoot.textContent = `Java 17 路 Maven 路 ${state.workBranch}`;
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
        <div class="wr-workspace" id="wr-workspace" title="鎶樺彔/灞曞紑宸ヤ綔鍖�">
          <span class="wr-caret">${state.workCollapsed ? "鈻�" : "鈻�"}</span>
          <span class="wr-workspace-name">ttigd-manage-web</span>
        </div>
        ${
          state.workCollapsed
            ? ""
            : `<div class="wr-branch" id="wr-branch" title="鍒囨崲鍒嗘敮">
                <span class="wr-branch-name">${escapeHtml(state.workBranch)}</span>
                <span class="wr-caret">鈻�</span>
                <span class="wr-changes">3 changes</span>
              </div>
              ${menu}
              ${workTreeHtml(WORK_TREE, 0)}`
        }
      </div>`;
      return;
    }
    ui.sideTitle.textContent = "寰俊璇讳功";
    ui.sideFoot.textContent = "浠呮樉绀烘敮鎸� PDF 闃呰鐨勪功";
    const books = mergedBooks();
    ui.list.innerHTML = books
      .map((b) => {
        const active = state.ctx && b.key === state.ctx.key;
        const disabled = !b.readerUrl && !active;
        const sub = active
          ? "PDF 鏂囨。 路 鐐瑰嚮鍗＄墖棰勮"
          : disabled
            ? "PDF 路 璇峰厛鍦ㄥ畼鏂逛功鏋剁偣寮€涓€娆�"
            : `PDF 路 ${b.lastReadAt ? timeAgo(b.lastReadAt) : "灏氭湭鎵撳紑"}`;
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
          <div class="wr-head-title" id="wr-head-title" title="鐐瑰嚮闅愯棌/鏄剧ず闃呰鍖�">${escapeHtml(WORK_DOC_NAME)}</div>
          <div class="wr-head-sub">宸ヤ綔鏂囨。 路 PDF</div>
        </div>
        <span class="wr-head-spacer"></span>
        <button class="wr-exit" id="wr-exit" title="閫€鍑哄井淇℃ā寮�">鈴�</button>
      `;
    } else {
      const sub = ctx.author ? `${ctx.author} 路 PDF` : "PDF 鏂囨。";
      ui.head.innerHTML = `
        ${avatarHtml(ctx, "wr-head-cover")}
        <div class="wr-head-main">
          <div class="wr-head-title" id="wr-head-title" title="鐐瑰嚮闅愯棌/鏄剧ず闃呰鍖�">${escapeHtml(ctx.title)}</div>
          <div class="wr-head-sub">${escapeHtml(sub)}</div>
        </div>
        <span class="wr-head-spacer"></span>
        <button class="wr-exit" id="wr-exit" title="閫€鍑哄井淇℃ā寮�">鈴�</button>
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
        <div class="wr-chatlog-head"><span class="wr-pv-dot"></span>杩愯鏃ュ織<span class="wr-log-src" id="wr-chatlog-src">妯℃嫙</span></div>
        <div class="wr-chatlog-body" id="wr-chatlog-body"></div>
      </div>`;
      startChatLogs();
      return;
    }
    ui.chat.classList.remove("is-logs");
    const docName = workDocName();
    ui.chat.innerHTML = `
      <div class="wr-sys">鈥斺€� ${escapeHtml(docName)} 鈥斺€�</div>
      <div class="wr-file" id="wr-file" role="button" tabindex="0" title="鐐瑰嚮棰勮鏂囨。">
        <div class="wr-file-icon">PDF</div>
        <div class="wr-file-main">
          <div class="wr-file-name">${escapeHtml(docName)}</div>
          <div class="wr-file-sub">PDF 鏂囨。 路 鐐瑰嚮棰勮</div>
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

  /* ============================== PDF 棰勮 ============================== */

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
      warn("鑾峰彇 PDF 鍦板潃澶辫触", e && e.message ? e.message : e);
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
        reject(new Error("褰撳墠鑴氭湰绠＄悊鍣ㄤ笉鏀寔 GM_xmlhttpRequest"));
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
          onerror: () => done(reject, new Error("缃戠粶閿欒")),
          ontimeout: () => done(reject, new Error("涓嬭浇瓒呮椂")),
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
        warn("GM 涓嬭浇澶辫触锛屽皾璇曢〉闈� fetch", e2 && e2.message ? e2.message : e2);
      }
    }
    if (!buf) {
      const fetchFn = typeof W.fetch === "function" ? W.fetch : window.fetch;
      const res = await fetchFn.call(W, url, { credentials: "omit" });
      if (!res || !res.ok) {
        throw new Error(`HTTP ${(res && res.status) || 0}${gmError ? `锛圙M锛�${gmError.message}锛塦 : ""}`);
      }
      buf = await res.arrayBuffer();
    }
    if (!buf || (buf.byteLength != null && buf.byteLength === 0)) throw new Error("鏂囨。鍐呭涓虹┖");
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
      /* 璧� GM */
    }
    if (!pdfWorkerText) {
      pdfWorkerText = await new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== "function") {
          reject(new Error("鏃犳硶鍔犺浇 PDF worker"));
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
            onerror: () => reject(new Error("worker 缃戠粶閿欒")),
            ontimeout: () => reject(new Error("worker 涓嬭浇瓒呮椂")),
          });
        } catch (e) {
          reject(e);
        }
      });
    }
    if (!pdfWorkerText) throw new Error("PDF worker 鍐呭涓虹┖");
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
    if (!lib) throw new Error("PDF 娓叉煋搴撴湭鍔犺浇锛園require 澶辫触鎴栫绾匡級");
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
    throw lastErr || new Error("PDF 鍔犺浇澶辫触");
  }

  function pvBarHtml(extra) {
    const title = workDocName();
    return `<div class="wr-pv-bar">
      <button class="wr-pv-btn" id="wr-pv-back">鈥� 杩斿洖</button>
      <span class="wr-pv-title" id="wr-pv-title" title="鐐瑰嚮闅愯棌/鏄剧ず闃呰鍖�">${escapeHtml(title)}</span>
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
          <div class="wr-pv-status">${escapeHtml(message || "姝ｅ湪鑾峰彇鏂囨。鈥�")}</div>
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
            <div>${escapeHtml(message || "鏂囨。鎵撳紑澶辫触")}</div>
            <div style="margin-top:12px;">
              <button id="wr-retry">閲嶆柊鑾峰彇</button>
              ${url ? `<a class="wr-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">涓嬭浇鍘熸枃浠�</a>` : ""}
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

  /* ---------- 宸ヤ綔鏃ュ織鑳屾櫙 ---------- */

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
    ["INFO", "ci-runner", () => `[build ${randInt(4700, 4999)}] npm test 鈥� ${randInt(180, 400)} passed`, 2],
    ["INFO", "deploy", () => `staging ${hexId(7)} rolled out ${randInt(1, 4)}/4`, 1],
    ["WARN", "inventory", () => `stock below threshold sku=SKU-${randInt(1000, 9999)}`, 1],
    [
      "INFO",
      "payment",
      () => `settlement batch=${randInt(100, 999)} amount=楼${randInt(10, 999)}.${randInt(10, 99)}`,
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
    setLogSrc(srcEl, "杩炴帴涓€�", "", "姝ｅ湪杩炴帴 Grafana");

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
            warn("Grafana 鏃ュ織涓嶅彲鐢紝浣跨敤妯℃嫙鏃ュ織", err.message || err);
          }
          setLogSrc(srcEl, feed.first ? "绂荤嚎" : "妯℃嫙", "", "Grafana 涓嶅彲鐢紝浣跨敤妯℃嫙鏃ュ織");
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        if (status === 401 || status === 403) {
          if (!feed.warned) {
            feed.warned = true;
            warn("Grafana 鏃ュ織鏈櫥褰曪紙HTTP " + status + "锛�");
          }
          setLogSrc(srcEl, "鏈櫥褰�", "err", "鐐瑰嚮鎵撳紑 Grafana 鐧诲綍");
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        if (status < 200 || status >= 300) {
          if (!feed.warned) {
            feed.warned = true;
            warn("Grafana 鏃ュ織杩斿洖 HTTP " + status);
          }
          setLogSrc(srcEl, feed.first ? "绂荤嚎" : "妯℃嫙", "", `Grafana HTTP ${status}`);
          feed.retryAt = Date.now() + REAL_LOGS.retryMs;
          return;
        }
        let rows;
        try {
          rows = parseLokiRows(text);
        } catch (e) {
          setLogSrc(srcEl, feed.first ? "绂荤嚎" : "妯℃嫙", "", "Grafana 杩斿洖鏃犳硶瑙ｆ瀽");
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
        if (!el.childElementCount) el.innerHTML = '<div class="wr-log-empty">鏆傛棤鏃ュ織</div>';
        feed.warned = false;
        setLogSrc(srcEl, "瀹炴椂", "live", "Grafana Loki 路 鐐瑰嚮鎵撳紑 Explore");
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

  /* ---------- 鑷缓 PDF 闃呰鍣� ---------- */

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
        <button class="wr-pv-btn" id="wr-pv-prev" title="涓婁竴椤�">鈥�</button>
        <span class="wr-pv-pageno"><input id="wr-pv-page-input" value="1" inputmode="numeric"> / <span id="wr-pv-page-count">鈥�</span></span>
        <button class="wr-pv-btn" id="wr-pv-next" title="涓嬩竴椤�">鈥�</button>
        <button class="wr-pv-btn" id="wr-pv-zoom-out" title="缂╁皬">鈭�</button>
        <span class="wr-pv-zoom" id="wr-pv-zoom">${Math.round(DEFAULT_ZOOM * 100)}%</span>
        <button class="wr-pv-btn" id="wr-pv-zoom-in" title="鏀惧ぇ">+</button>
        <button class="wr-pv-btn" id="wr-pv-fit">閫傚簲瀹藉害</button>
        <button class="wr-pv-btn active" id="wr-pv-logs" title="鍒囨崲鏃ュ織鏍�">鏃ュ織</button>
      `)}
      <div class="wr-pv-body" id="wr-pv-body">
        <div class="wr-pv-main">
          <div class="wr-pv-scroll" id="wr-pv-scroll"><div class="wr-pv-pages" id="wr-pv-pages"></div></div>
          <div class="wr-pv-status" id="wr-pv-status">姝ｅ湪瑙ｆ瀽鏂囨。鈥�</div>
        </div>
        <div class="wr-pv-logresizer" id="wr-pv-logresizer" title="鎷栧姩璋冩暣鏃ュ織鏍忓搴�"></div>
        <aside class="wr-pv-logpane" id="wr-pv-logpane">
          <div class="wr-pv-loghead"><span class="wr-pv-dot"></span>杩愯鏃ュ織<span class="wr-log-src" id="wr-pv-log-src">妯℃嫙</span></div>
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
        toast("鐐瑰嚮椤堕儴鏂囦欢鍚嶅彲鍒囧洖闃呰鍖�");
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
        if (!ctx) throw new Error("鏃犳硶鍒涘缓鐢诲竷");
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
          p.el.innerHTML = `<div class="wr-pv-page-err">绗� ${p.num} 椤垫覆鏌撳け璐�</div>`;
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
      window.removeEventListener("resize", v.resizeHandler);
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
      if (!v.pageCount) throw new Error("鏂囨。娌℃湁鍙樉绀虹殑椤甸潰");
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
    const token = ++state.previewToken;
    destroyViewer();
    showPreviewLoading("姝ｅ湪鑾峰彇鏂囨。鈥�");
    const url = await resolvePdfUrl();
    if (token !== state.previewToken) return;
    if (!url) {
      showPreviewError("娌℃湁鎷垮埌 PDF 鍦板潃锛岃鐐广€岄噸鏂拌幏鍙栥€嶆垨鍥炲畼鏂归槄璇诲櫒鎵撳紑涓€娆�", "");
      return;
    }

    showPreviewLoading("姝ｅ湪涓嬭浇鏂囨。鈥�");
    try {
      const buf = await downloadPdfBytes(url, (loaded, total) => {
        if (token !== state.previewToken) return;
        const pct = total ? Math.floor((loaded / total) * 100) : null;
        setPreviewStatus(pct == null ? "姝ｅ湪涓嬭浇鏂囨。鈥�" : `姝ｅ湪涓嬭浇鏂囨。 ${pct}%`);
      });
      if (token !== state.previewToken) return;
      showPreviewLoading("姝ｅ湪瑙ｆ瀽鏂囨。鈥�");
      await showPdfViewer(buf, url, token);
    } catch (e) {
      if (token !== state.previewToken) return;
      destroyViewer();
      showPreviewError(`鏂囨。鍔犺浇澶辫触锛�${e && e.message ? e.message : e}`, url);
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

  /* ============================== 杩涘叆 / 閫€鍑� ============================== */

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
    toast("宸查€€鍑哄井淇℃ā寮�");
  }

  function mount(ctx) {
    state.ctx = ctx;
    if (!document.title.includes("宸ヤ綔鐩綍")) state.originalTitle = document.title;
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
    log(`宸叉帴绠� PDF 涔︺€�${ctx.title}銆�${ctx.cbBookId ? ` 路 ${ctx.cbBookId}` : ""}`);
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

  /* ============================== 鍚姩 ============================== */

  async function boot() {
    if (!isReaderPage()) return;
    const token = ++state.bootToken;
    const ctx = await waitForPdf(DETECT_TIMEOUT);
    if (token !== state.bootToken) return;
    if (!ctx) {
      log("鏈娴嬪埌 PDF 绠＄嚎锛屼繚鎸佸畼鏂圭晫闈�");
      return;
    }
    mount(ctx);
  }

  let lastReaderInfoId = isReaderPage() ? pathInfoId() : "";

  function watchRoute() {
    setInterval(() => {
      if (!isReaderPage()) {
        if (state.ui || state.ctx) teardown();
        lastReaderInfoId = "";
        return;
      }
      const id = pathInfoId();
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
      GM_registerMenuCommand("杩涘叆/閫€鍑哄井淇℃ā寮�", () => {
        if (state.enabled && state.ui) exitMode();
        else if (state.ctx) enterMode();
        else safeBoot();
      });
      GM_registerMenuCommand("鍒锋柊涔︽灦", () => {
        state.shelf = [];
        loadShelf(true);
        toast("姝ｅ湪鍒锋柊涔︽灦鈥�");
      });
      GM_registerMenuCommand("璁剧疆 Grafana Token", () => {
        const next = window.prompt("绮樿创 Grafana Service Account Token锛堢暀绌� = 浣跨敤娴忚鍣ㄧ櫥褰曟€侊級", "");
        if (next === null) return;
        storeSet(STORE.grafanaToken, String(next).trim());
        restartRealLogs();
        toast("Grafana Token 宸蹭繚瀛�");
      });
      GM_registerMenuCommand("娓呴櫎 Grafana Token", () => {
        storeSet(STORE.grafanaToken, "");
        restartRealLogs();
        toast("宸叉竻闄� Grafana Token");
      });
    } catch (e) {
      /* ignore */
    }
  }

  function safeBoot() {
    boot().catch((e) => warn("鍚姩澶辫触", e));
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
    detect: detectPdf,
    enter: enterMode,
    exit: exitMode,
    refreshShelf: () => {
      state.shelf = [];
      state.shelfLoaded = false;
      loadShelf(true);
    },
  };

  log(`v${VERSION} 宸插惎鍔╜);
})();
