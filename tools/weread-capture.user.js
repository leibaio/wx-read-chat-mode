// ==UserScript==
// @name         微信读书抓包调试器（只读）
// @namespace    weread-chat-mode-capture
// @version      0.2.0
// @description  只读记录微信读书页面自身的 fetch/XHR 请求，用于定位章节正文接口。不修改请求、不上传数据。
// @author       weread-chat-mode
// @license      MIT
// @match        https://weread.qq.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

/*
 * v0.2：
 *   - 额外记录 Worker 构造、PerformanceResourceTiming 中与正文相关的资源
 *   - 请求头 x-wrpa-*（微信读书的请求签名）与 sentry 头一并打码/过滤
 *   - 快照额外输出 __INITIAL_STATE__ 顶层/reader 字段名、iframe、storage key 名
 *
 * 用法：
 *   1. 在已登录的微信读书阅读页打开本脚本，右下角会出现「WR抓包」徽标。
 *   2. 打开一本【官方书城的文字 EPUB 书】（不要用导入 PDF/漫画），翻 1~2 页或从目录跳到下一章。
 *   3. 点「导出 JSON」，把下载的文件发回。
 *
 * 隐私：
 *   - 不记录 Cookie / Set-Cookie / Authorization / x-wrpa-*。
 *   - URL 中的 skey / token / ticket / sig 等参数会打码。
 *   - 正文响应最多保留前 256KB，仅用于确认接口结构。
 *
 * 控制台 API：
 *   __WR_CAPTURE__.entries     查看已捕获条目
 *   __WR_CAPTURE__.export()    读取导出对象
 *   __WR_CAPTURE__.snapshot()  读取当前页 __INITIAL_STATE__ 摘要
 *   __WR_CAPTURE__.clear()     清空
 */

(() => {
  "use strict";

  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  if (W.__WR_CAPTURE_INSTALLED__) return;
  W.__WR_CAPTURE_INSTALLED__ = true;

  const VERSION = "0.2.0";
  const LOG_PREFIX = "[WR抓包]";

  const LIMITS = {
    maxEntries: 400,
    bodyShort: 16 * 1024,
    bodyLong: 256 * 1024,
    totalBytes: 12 * 1024 * 1024,
    jsonKeys: 40,
    jsonDepth: 4,
  };

  const SENSITIVE_HEADERS =
    /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-wrpa-\d+|wr_skey)$/i;
  const SENSITIVE_PARAMS = /^(skey|token|ticket|sig|signature|access_token|key)$/i;
  const NOISE_HEADERS = /^(sentry-trace|baggage|x-request-id|traceparent|tracestate)$/i;
  const STATIC_EXT =
    /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|m4a|wav|pdf)(?:[?#]|$)/i;
  const NOISE_URL =
    /(google-analytics|googletagmanager|doubleclick|hm\.baidu|cnzz|sentry|bugly|beacon|tlog|monitor\.|analytics\.|\/log(?:\?|$))/i;

  const state = {
    paused: false,
    seq: 0,
    entries: [],
    totalBytes: 0,
    workers: [],
  };

  let ui = null;
  let rafQueued = false;
  let detailId = null;

  /* ============================== 工具 ============================== */

  const now = () => Date.now();

  function fmtClock(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function safeString(v) {
    try {
      return typeof v === "string" ? v : JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  function clip(s, max) {
    const text = s == null ? "" : String(s);
    return text.length > max
      ? { text: text.slice(0, max), truncated: true, fullLength: text.length }
      : { text, truncated: false, fullLength: text.length };
  }

  function bodyLimitFor(url) {
    return /(chapter|content|reader)/i.test(url) ? LIMITS.bodyLong : LIMITS.bodyShort;
  }

  function fmtBytes(n) {
    const num = Number(n);
    if (!isFinite(num) || num <= 0) return "0B";
    if (num < 1024) return `${num}B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)}KB`;
    return `${(num / 1024 / 1024).toFixed(1)}MB`;
  }

  function maskUrl(raw) {
    let href = String(raw == null ? "" : raw);
    try {
      const u = new URL(href, location.href);
      let changed = false;
      for (const k of Array.from(u.searchParams.keys())) {
        if (SENSITIVE_PARAMS.test(k)) {
          u.searchParams.set(k, "***");
          changed = true;
        }
      }
      return changed ? u.href : href;
    } catch (e) {
      return href.replace(/([?&](?:skey|token|ticket|sig|signature|access_token|key)=)[^&#]*/gi, "$1***");
    }
  }

  function shouldSkipUrl(url) {
    if (!url) return true;
    if (/^(data|blob|about|javascript):/i.test(url)) return true;
    if (STATIC_EXT.test(url)) return true;
    if (NOISE_URL.test(url)) return true;
    return false;
  }

  function headersToObject(h) {
    const out = {};
    const add = (k, v) => {
      const key = String(k || "").toLowerCase();
      if (!key || SENSITIVE_HEADERS.test(key) || NOISE_HEADERS.test(key)) return;
      const val = String(v == null ? "" : v);
      out[key] = val.length > 300 ? `${val.slice(0, 300)}…` : val;
    };
    if (!h) return out;
    try {
      const H = W.Headers || (typeof Headers !== "undefined" ? Headers : null);
      if (H) {
        new H(h).forEach((v, k) => add(k, v));
        return out;
      }
    } catch (e) {
      /* 继续走兜底 */
    }
    try {
      if (Array.isArray(h)) {
        h.forEach((pair) => Array.isArray(pair) && add(pair[0], pair[1]));
      } else if (typeof h.forEach === "function") {
        h.forEach((v, k) => add(k, v));
      } else if (typeof h === "object") {
        for (const k of Object.keys(h)) add(k, h[k]);
      }
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  function hasSigningHeader(h) {
    if (!h) return false;
    try {
      const H = W.Headers || (typeof Headers !== "undefined" ? Headers : null);
      if (H) {
        const headers = new H(h);
        for (let i = 0; i < 4; i++) if (headers.has(`x-wrpa-${i}`)) return true;
        return false;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      if (Array.isArray(h)) return h.some((p) => /^x-wrpa-/i.test(String(p && p[0])));
      if (typeof h === "object") return Object.keys(h).some((k) => /^x-wrpa-/i.test(k));
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function parseRawHeaders(raw) {
    const out = {};
    String(raw || "")
      .trim()
      .split(/[\r\n]+/)
      .forEach((line) => {
        const idx = line.indexOf(":");
        if (idx <= 0) return;
        const k = line.slice(0, idx).trim().toLowerCase();
        if (!k || SENSITIVE_HEADERS.test(k) || NOISE_HEADERS.test(k)) return;
        let v = line.slice(idx + 1).trim();
        if (v.length > 300) v = `${v.slice(0, 300)}…`;
        out[k] = v;
      });
    return out;
  }

  function describeBody(body) {
    if (body == null) return "";
    try {
      if (typeof body === "string") return clip(body, LIMITS.bodyShort).text;
      const US = W.URLSearchParams || (typeof URLSearchParams !== "undefined" ? URLSearchParams : null);
      if (US && body instanceof US) return clip(body.toString(), LIMITS.bodyShort).text;
      const FD = W.FormData || (typeof FormData !== "undefined" ? FormData : null);
      if (FD && body instanceof FD) {
        const parts = [];
        body.forEach((v, k) => {
          if (typeof v === "string") parts.push(`${k}=${clip(v, 300).text}`);
          else
            parts.push(
              `${k}=[File ${v && v.name ? v.name : ""} ${v && v.size ? v.size : 0}B ${v && v.type ? v.type : ""}]`,
            );
        });
        return clip(parts.join("&"), LIMITS.bodyShort).text;
      }
      const BlobCtor = W.Blob || (typeof Blob !== "undefined" ? Blob : null);
      if (BlobCtor && body instanceof BlobCtor) return `[Blob ${body.size}B ${body.type || ""}]`;
      const AB = W.ArrayBuffer || (typeof ArrayBuffer !== "undefined" ? ArrayBuffer : null);
      if (AB && (body instanceof AB || AB.isView(body))) return `[Binary ${body.byteLength || 0}B]`;
    } catch (e) {
      /* ignore */
    }
    return `[${Object.prototype.toString.call(body)}]`;
  }

  function jsonSummary(v, depth = 0) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") {
      return v.length > 200 ? { $string: `${v.slice(0, 200)}…`, length: v.length } : v;
    }
    if (t === "number" || t === "boolean") return v;
    if (depth >= LIMITS.jsonDepth) return Array.isArray(v) ? `[Array(${v.length})]` : "[Object]";
    if (Array.isArray(v)) {
      return { $array: v.length, sample: v.length ? jsonSummary(v[0], depth + 1) : null };
    }
    if (t === "object") {
      const out = {};
      let i = 0;
      for (const k of Object.keys(v)) {
        if (i++ >= LIMITS.jsonKeys) {
          out["…"] = "(更多字段已省略)";
          break;
        }
        out[k] = jsonSummary(v[k], depth + 1);
      }
      return out;
    }
    return String(v);
  }

  /* ============================== 记录 ============================== */

  function dropOldest() {
    const e = state.entries.shift();
    if (e) state.totalBytes -= e._bytes || 0;
  }

  function trimTotal() {
    while (state.totalBytes > LIMITS.totalBytes && state.entries.length > 1) dropOldest();
  }

  function begin(kind, method, url, reqHeaders, reqBody, force) {
    if (state.paused) return null;
    if (!force && shouldSkipUrl(url)) return null;

    const entry = {
      id: ++state.seq,
      kind,
      method: String(method || "GET").toUpperCase(),
      url: maskUrl(url),
      t: new Date().toISOString(),
      clock: fmtClock(Date.now()),
      status: null,
      durationMs: null,
      reqHeaders: reqHeaders || {},
      reqBody: reqBody || "",
      respHeaders: {},
      contentType: "",
      size: null,
      body: "",
      bodyTruncated: false,
      bodyLength: 0,
      jsonSummary: null,
      candidate: /(chapter|content|book|reader|shelf|review)/i.test(url),
      signed: false,
      likelyChapter: false,
      error: null,
      _start: now(),
      _bytes: 0,
    };

    state.entries.push(entry);
    while (state.entries.length > LIMITS.maxEntries) dropOldest();
    scheduleRender();
    return entry;
  }

  function absorbText(entry, txt) {
    const c = clip(txt, bodyLimitFor(entry.url));
    entry.body = c.text;
    entry.bodyTruncated = c.truncated;
    entry.bodyLength = c.fullLength;
    entry.size = entry.size != null ? entry.size : c.fullLength;

    if (/^\s*[[{]/.test(txt)) {
      try {
        entry.jsonSummary = jsonSummary(JSON.parse(txt));
      } catch (e) {
        /* 不是完整 JSON */
      }
    }

    if (!entry.jsonSummary && /<(p|div|span|br|img)\b/i.test(txt)) entry.marks = "html";
    if (entry.bodyLength > 4000 || entry.marks === "html" || /(chapter|content)/i.test(entry.url)) {
      entry.candidate = true;
    }
    if (/(chapter|content)/i.test(entry.url) && entry.bodyLength > 2000) entry.likelyChapter = true;

    entry._bytes = entry.body.length + (entry.jsonSummary ? safeString(entry.jsonSummary).length : 0);
    state.totalBytes += entry._bytes;
    trimTotal();
    scheduleRender();
  }

  function onFetchResponse(entry, resp) {
    entry.status = resp.status;
    entry.contentType = resp.headers.get("content-type") || "";
    entry.respHeaders = headersToObject(resp.headers);
    entry.durationMs = now() - entry._start;
    const len = resp.headers.get("content-length");
    if (len && /^\d+$/.test(len)) entry.size = Number(len);

    const ct = entry.contentType.toLowerCase();
    const readable =
      ct === "" ||
      ct.includes("json") ||
      ct.includes("text") ||
      ct.includes("html") ||
      ct.includes("xml") ||
      ct.includes("javascript");
    if (!readable) {
      scheduleRender();
      return;
    }

    try {
      resp
        .clone()
        .text()
        .then((txt) => absorbText(entry, txt))
        .catch((e) => {
          entry.error = String(e);
          scheduleRender();
        });
    } catch (e) {
      entry.error = String(e);
      scheduleRender();
    }
    scheduleRender();
  }

  function onXhrDone(entry, xhr) {
    entry.durationMs = now() - entry._start;
    try {
      entry.status = xhr.status;
    } catch (e) {
      /* ignore */
    }
    try {
      entry.contentType = (xhr.getResponseHeader("content-type") || "").toLowerCase();
    } catch (e) {
      /* ignore */
    }
    try {
      entry.respHeaders = parseRawHeaders(xhr.getAllResponseHeaders());
    } catch (e) {
      /* ignore */
    }

    let txt = null;
    try {
      const rt = xhr.responseType || "";
      if (rt === "" || rt === "text") {
        txt = xhr.responseText;
      } else if (rt === "json") {
        txt = xhr.response == null ? "" : JSON.stringify(xhr.response);
      } else if (rt === "document") {
        const Serializer = W.XMLSerializer || (typeof XMLSerializer !== "undefined" ? XMLSerializer : null);
        if (Serializer && xhr.response) txt = new Serializer().serializeToString(xhr.response);
      } else if (xhr.response) {
        entry.size =
          xhr.response.size != null
            ? xhr.response.size
            : xhr.response.byteLength != null
              ? xhr.response.byteLength
              : null;
      }
    } catch (e) {
      entry.error = String(e);
    }

    if (txt == null) {
      scheduleRender();
      return;
    }
    absorbText(entry, txt);
  }

  /* ============================== Worker / 资源时间线 ============================== */

  function recordWorker(url, opts) {
    try {
      const href = String(url || "");
      if (state.workers.length < 50) {
        state.workers.push({
          url: maskUrl(href),
          type: (opts && opts.type) || "classic",
          at: new Date().toISOString(),
        });
      }
      const rec = begin("worker", "GET", href, {}, "", true);
      if (rec) {
        rec.note = `Worker 构造（${(opts && opts.type) || "classic"}）：其内部的 fetch/XHR 不在主线程钩子范围内`;
        rec.candidate = true;
        scheduleRender();
      }
    } catch (e) {
      /* ignore */
    }
  }

  function recordResource(res) {
    const name = res.name || "";
    if (!name) return;
    if (shouldSkipUrl(name)) return;
    if (!/(chapter|content|book|reader|shelf|review)/i.test(name)) return;
    const masked = maskUrl(name);
    if (state.entries.some((e) => e.url === masked)) return;

    const rec = begin("resource", "GET", name, {}, "", true);
    if (!rec) return;
    rec.size = res.transferSize || res.encodedBodySize || null;
    rec.note = `PerformanceResourceTiming initiator=${res.initiatorType || "?"} duration=${Math.round(res.duration || 0)}ms`;
    rec.candidate = true;
    scheduleRender();
  }

  function installWorkerHook() {
    const Orig = W.Worker;
    if (typeof Orig !== "function") return;
    const Patched = function (url, opts) {
      recordWorker(url, opts);
      return new Orig(url, opts);
    };
    Patched.prototype = Orig.prototype;
    try {
      W.Worker = Patched;
    } catch (e) {
      /* ignore */
    }
  }

  function installPerformanceObserver() {
    const PO = W.PerformanceObserver;
    if (typeof PO !== "function") return;
    try {
      const po = new PO((list) => {
        for (const r of list.getEntries()) {
          try {
            recordResource(r);
          } catch (e) {
            /* ignore */
          }
        }
      });
      po.observe({ type: "resource", buffered: true });
    } catch (e) {
      /* ignore */
    }
  }

  /* ============================== 挂钩 ============================== */

  function installHooks() {
    const origFetch = W.fetch;
    if (typeof origFetch === "function") {
      W.fetch = function (input, init) {
        let rec = null;
        try {
          const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
          const method = (init && init.method) || (input && input.method) || "GET";
          const headerSource =
            (init && init.headers) || (input && typeof input === "object" && input.headers);
          rec = begin("fetch", method, url, headersToObject(headerSource), describeBody(init && init.body));
          if (rec && hasSigningHeader(headerSource)) rec.signed = true;
          if (
            rec &&
            input &&
            typeof input === "object" &&
            input.body &&
            typeof input.clone === "function" &&
            !(init && init.body)
          ) {
            input
              .clone()
              .text()
              .then((t) => {
                rec.reqBody = clip(t, LIMITS.bodyShort).text;
              })
              .catch(() => {});
          }
        } catch (e) {
          /* 记录失败不能影响页面 */
        }

        const promise = origFetch.apply(this, arguments);
        if (rec) {
          try {
            promise.then(
              (resp) => {
                try {
                  onFetchResponse(rec, resp);
                } catch (e) {
                  rec.error = String(e);
                  scheduleRender();
                }
              },
              (err) => {
                rec.error = String(err);
                rec.durationMs = now() - rec._start;
                scheduleRender();
              },
            );
          } catch (e) {
            /* ignore */
          }
        }
        return promise;
      };
    }

    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      const origSetHeader = XHR.prototype.setRequestHeader;

      XHR.prototype.open = function (method, url) {
        try {
          this.__wrMeta = { method, url: String(url), headers: {} };
        } catch (e) {
          /* ignore */
        }
        return origOpen.apply(this, arguments);
      };

      if (typeof origSetHeader === "function") {
        XHR.prototype.setRequestHeader = function (k, v) {
          try {
            if (this.__wrMeta) {
              const key = String(k || "").toLowerCase();
              if (/^x-wrpa-/i.test(key)) this.__wrMeta.signed = true;
              if (!SENSITIVE_HEADERS.test(key)) {
                const val = String(v == null ? "" : v);
                this.__wrMeta.headers[key] = val.length > 300 ? `${val.slice(0, 300)}…` : val;
              }
            }
          } catch (e) {
            /* ignore */
          }
          return origSetHeader.apply(this, arguments);
        };
      }

      XHR.prototype.send = function (body) {
        let rec = null;
        try {
          const meta = this.__wrMeta || {};
          rec = begin("xhr", meta.method, meta.url, meta.headers, describeBody(body));
          if (rec && meta.signed) rec.signed = true;
          if (rec) {
            this.addEventListener(
              "loadend",
              () => {
                try {
                  onXhrDone(rec, this);
                } catch (e) {
                  rec.error = String(e);
                  scheduleRender();
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
    }

    installWorkerHook();
    installPerformanceObserver();
  }

  /* ============================== 页面状态快照 ============================== */

  function pathInfoId() {
    try {
      const m = location.pathname.match(/\/web\/reader\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function storageKeyNames() {
    const out = { local: [], session: [] };
    try {
      for (let i = 0; i < localStorage.length && i < 200; i++) out.local.push(localStorage.key(i));
    } catch (e) {
      /* ignore */
    }
    try {
      for (let i = 0; i < sessionStorage.length && i < 200; i++) out.session.push(sessionStorage.key(i));
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  function pageStateSnapshot() {
    const out = {
      href: location.href,
      pathInfoId: pathInfoId(),
      title: document.title,
      userAgent: navigator.userAgent,
      time: new Date().toISOString(),
      nuxtDataPresent: !!W.__NUXT_DATA__,
    };
    try {
      const s = W.__INITIAL_STATE__;
      out.topKeys = s ? Object.keys(s).slice(0, 80) : null;
      if (!s || !s.reader) {
        out.reader = null;
        out.note = "未找到 __INITIAL_STATE__.reader（可能尚未进入阅读页，或页面结构已变化）";
      } else {
        const r = s.reader;
        const bi = r.bookInfo || null;
        out.readerKeys = Object.keys(r).slice(0, 120);
        out.reader = {
          infoId: r.infoId || out.pathInfoId,
          bookId: r.bookId || (bi && bi.bookId) || null,
          bookInfo: bi
            ? {
                bookId: bi.bookId,
                title: bi.title,
                author: bi.author,
                translator: bi.translator || "",
                format: bi.format,
                type: bi.type,
                free: bi.free,
                payingStatus: bi.payingStatus,
                price: bi.price,
                maxFreeChapter: bi.maxFreeChapter,
                maxFreeInfo: bi.maxFreeInfo || null,
                lastChapterIdx: bi.lastChapterIdx,
                cover: bi.cover,
              }
            : null,
          currentChapter: r.currentChapter || null,
          chapterContentState: r.chapterContentState || null,
          chapterCount: Array.isArray(r.chapterInfos) ? r.chapterInfos.length : null,
          chapterInfos: Array.isArray(r.chapterInfos) ? r.chapterInfos.slice(0, 80) : null,
          progress: r.progress || null,
          lastProgressPayload: r.lastProgressPayload || null,
          isInShelf: r.isInShelf,
          pdfUrl: r.pdfUrl || null,
          isBookForbidden: r.isBookForbidden,
        };
      }
      out.user =
        s && s.user ? { name: s.user.name || "", hasSkey: !!s.user.skey, vid: s.user.vid || null } : null;
    } catch (e) {
      out.error = String(e);
    }
    try {
      out.iframes = Array.from(document.querySelectorAll("iframe"))
        .slice(0, 20)
        .map((f) => f.src || "(no src)");
    } catch (e) {
      /* ignore */
    }
    try {
      out.storageKeys = storageKeyNames();
    } catch (e) {
      /* ignore */
    }
    out.workers = state.workers.slice();
    return out;
  }

  /* ============================== 导出 ============================== */

  function publicEntry(e) {
    const { _start, _bytes, ...rest } = e;
    return rest;
  }

  function buildExport() {
    return {
      script: "weread-capture-debug",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      snapshot: pageStateSnapshot(),
      counts: {
        entries: state.entries.length,
        totalBytes: state.totalBytes,
        workers: state.workers.length,
        paused: state.paused,
      },
      entries: state.entries.map(publicEntry),
    };
  }

  function exportFileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `weread-capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  }

  function downloadExport() {
    try {
      const blob = new Blob([JSON.stringify(buildExport(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.download = exportFileName();
      a.href = URL.createObjectURL(blob);
      a.style.display = "none";
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 10000);
      toast(`已导出 ${state.entries.length} 条记录`);
    } catch (e) {
      toast(`导出失败：${e && e.message ? e.message : e}`);
    }
  }

  async function copyExport() {
    const text = JSON.stringify(buildExport(), null, 2);
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        toast("已复制到剪贴板");
        return;
      }
    } catch (e) {
      /* 走浏览器剪贴板 */
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制到剪贴板");
    } catch (e) {
      toast("复制失败，请用「导出 JSON」");
    }
  }

  /* ============================== UI ============================== */

  function toast(message) {
    if (!ui) return;
    const el = ui.shadow.getElementById("wr-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function scheduleRender() {
    if (!ui) return;
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      render();
    });
  }

  function entryPreview(e) {
    const item = publicEntry(e);
    if (item.body && item.body.length > 3000) {
      item.body = `${item.body.slice(0, 3000)}\n…[预览截断，完整内容见导出文件]`;
    }
    return JSON.stringify(item, null, 2);
  }

  function render() {
    if (!ui) return;
    const { shadow, badgeCount, list, detail, pauseBtn, filterEl } = ui;
    badgeCount.textContent = String(state.entries.length);
    pauseBtn.textContent = state.paused ? "继续" : "暂停";

    if (!shadow.getElementById("panel").classList.contains("open")) return;

    const onlyCandidate = filterEl.checked;
    const rows = [...state.entries]
      .filter((e) => !onlyCandidate || e.candidate || e.likelyChapter)
      .sort(
        (a, b) =>
          Number(b.likelyChapter) - Number(a.likelyChapter) ||
          Number(b.candidate) - Number(a.candidate) ||
          b.id - a.id,
      )
      .slice(0, 200);

    list.innerHTML = rows
      .map((e) => {
        const path = (() => {
          try {
            const u = new URL(e.url, location.href);
            return `${u.pathname}${u.search ? `${u.search.slice(0, 60)}${u.search.length > 60 ? "…" : ""}` : ""}`;
          } catch (err) {
            return e.url.slice(0, 90);
          }
        })();
        const cls = [e.likelyChapter ? "likely" : "", e.id === detailId ? "active" : ""]
          .filter(Boolean)
          .join(" ");
        const methodLabel = e.kind === "worker" ? "W" : e.kind === "resource" ? "R" : e.method;
        return `<div class="row ${cls}" data-id="${e.id}">
          <span class="clock">${e.clock}</span>
          <span class="method" title="${escapeAttr(e.kind)}">${escapeHtml(methodLabel)}</span>
          <span class="status ${e.status && e.status >= 400 ? "bad" : ""}">${e.status == null ? "…" : e.status}</span>
          <span class="path" title="${escapeAttr(e.url)}">${escapeHtml(path)}</span>
          <span class="size">${e.bodyLength ? fmtBytes(e.bodyLength) : e.size != null ? fmtBytes(e.size) : ""}</span>
        </div>`;
      })
      .join("");

    if (detailId == null) {
      detail.textContent = "点击一条记录查看详情。蓝色/高亮项为疑似正文接口。";
    } else {
      const item = state.entries.find((e) => e.id === detailId);
      detail.textContent = item ? entryPreview(item) : "记录已被回收";
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

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function mountUi() {
    if (ui) return;

    const host = document.createElement("div");
    host.id = "wr-capture-host";
    host.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .wrap { font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #e6e6e6; }
        .badge {
          display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 18px;
          background: #1f7a4d; color: #fff; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.28);
          font-size: 12px; user-select: none;
        }
        .badge b { background: rgba(255,255,255,.22); border-radius: 9px; padding: 0 6px; font-weight: 600; }
        .panel {
          display: none; width: 620px; max-width: calc(100vw - 28px); background: #1b1d21; border: 1px solid #30343b;
          border-radius: 10px; box-shadow: 0 18px 48px rgba(0,0,0,.45); overflow: hidden;
        }
        .panel.open { display: block; }
        .head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #23262b; border-bottom: 1px solid #30343b; }
        .head .title { font-weight: 600; font-size: 13px; }
        .head .hint { color: #8b929c; font-size: 11px; }
        .head .grow { flex: 1; }
        .head .close { cursor: pointer; color: #9aa1ab; font-size: 16px; line-height: 1; padding: 2px 4px; }
        .head .close:hover { color: #fff; }
        .tools { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #2a2d33; flex-wrap: wrap; }
        button {
          font: inherit; color: #e6e6e6; background: #2c3037; border: 1px solid #3a3f47; border-radius: 6px;
          padding: 4px 9px; cursor: pointer;
        }
        button:hover { background: #363b44; }
        button.primary { background: #1f7a4d; border-color: #27965f; }
        button.primary:hover { background: #27965f; }
        label.filter { display: inline-flex; align-items: center; gap: 4px; color: #a8aeb8; cursor: pointer; }
        .list { max-height: 38vh; overflow: auto; border-bottom: 1px solid #2a2d33; }
        .row {
          display: grid; grid-template-columns: 68px 48px 38px 1fr 58px; gap: 6px; align-items: center;
          padding: 4px 12px; border-bottom: 1px solid #24272c; cursor: pointer; white-space: nowrap;
        }
        .row:hover { background: #242830; }
        .row.active { background: #2b3440; }
        .row.likely { background: #1e2f26; }
        .row.likely.active { background: #274232; }
        .clock { color: #7f8792; }
        .method { color: #8ec5ff; overflow: hidden; text-overflow: ellipsis; }
        .status { text-align: right; color: #9ec99a; }
        .status.bad { color: #ef8a8a; }
        .path { overflow: hidden; text-overflow: ellipsis; color: #cfd4dc; }
        .row.likely .path { color: #9fe3b8; font-weight: 600; }
        .size { text-align: right; color: #7f8792; }
        .detail {
          margin: 0; padding: 10px 12px; max-height: 30vh; overflow: auto; font: 11px/1.5 Consolas, "SFMono-Regular", monospace;
          color: #bfc6d1; white-space: pre-wrap; word-break: break-all; background: #16181b;
        }
        .foot { padding: 6px 12px; color: #7f8792; font-size: 11px; border-top: 1px solid #24272c; }
        .toast {
          position: fixed; right: 0; bottom: 64px; background: #2b3440; color: #fff; padding: 7px 12px; border-radius: 8px;
          opacity: 0; transform: translateY(6px); transition: all .18s ease; pointer-events: none; font-size: 12px;
        }
        .toast.show { opacity: 1; transform: translateY(0); }
      </style>
      <div class="wrap">
        <div class="badge" id="badge">📡 WR抓包 <b id="count">0</b></div>
        <div class="panel" id="panel">
          <div class="head">
            <span class="title">微信读书抓包（只读）</span>
            <span class="hint">v${VERSION} · 不记录 Cookie</span>
            <span class="grow"></span>
            <span class="close" id="close">×</span>
          </div>
          <div class="tools">
            <button class="primary" id="export">导出 JSON</button>
            <button id="copy">复制 JSON</button>
            <button id="pause">暂停</button>
            <button id="clear">清空</button>
            <label class="filter"><input type="checkbox" id="filter"> 只看候选</label>
          </div>
          <div class="list" id="list"></div>
          <pre class="detail" id="detail"></pre>
          <div class="foot">翻 1~2 页/章后点「导出 JSON」。W = Worker，R = 资源时间线，高亮行 = 疑似正文接口。</div>
        </div>
        <div class="toast" id="wr-toast"></div>
      </div>
    `;

    (document.body || document.documentElement).appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    const panel = $("#panel");
    const list = $("#list");
    const detail = $("#detail");
    const filterEl = $("#filter");
    const pauseBtn = $("#pause");

    $("#badge").addEventListener("click", () => {
      panel.classList.toggle("open");
      render();
    });
    $("#close").addEventListener("click", () => panel.classList.remove("open"));
    $("#export").addEventListener("click", downloadExport);
    $("#copy").addEventListener("click", copyExport);
    $("#clear").addEventListener("click", () => {
      state.entries = [];
      state.totalBytes = 0;
      state.workers = [];
      detailId = null;
      render();
      toast("已清空");
    });
    pauseBtn.addEventListener("click", () => {
      state.paused = !state.paused;
      render();
      toast(state.paused ? "已暂停记录" : "继续记录");
    });
    filterEl.addEventListener("change", render);
    list.addEventListener("click", (ev) => {
      const row = ev.target.closest(".row");
      if (!row) return;
      const id = Number(row.dataset.id);
      detailId = detailId === id ? null : id;
      render();
    });

    ui = { host, shadow, badgeCount: $("#count"), list, detail, pauseBtn, filterEl };
    render();
  }

  /* ============================== 启动 ============================== */

  installHooks();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountUi, { once: true });
  } else {
    mountUi();
  }

  if (typeof GM_registerMenuCommand === "function") {
    try {
      GM_registerMenuCommand("导出抓包 JSON", downloadExport);
      GM_registerMenuCommand("复制抓包 JSON", copyExport);
      GM_registerMenuCommand("清空抓包记录", () => {
        state.entries = [];
        state.totalBytes = 0;
        detailId = null;
        render();
      });
      GM_registerMenuCommand("暂停/继续记录", () => {
        state.paused = !state.paused;
        render();
      });
    } catch (e) {
      /* ignore */
    }
  }

  W.__WR_CAPTURE__ = {
    get entries() {
      return state.entries.slice();
    },
    export: buildExport,
    snapshot: pageStateSnapshot,
    clear() {
      state.entries = [];
      state.totalBytes = 0;
      state.workers = [];
      detailId = null;
      render();
    },
    pause() {
      state.paused = true;
      render();
    },
    resume() {
      state.paused = false;
      render();
    },
  };

  console.log(`${LOG_PREFIX} v${VERSION} 已启动；控制台可访问 __WR_CAPTURE__`);
})();
