# 微信读书抓包调试器

一个**只读**的 Tampermonkey 调试脚本，用来定位微信读书网页版的「章节正文」接口。

它只做三件事：

1. 在页面加载前挂钩 `fetch` / `XMLHttpRequest`，记录请求与响应；同时记录 Worker 构造与 `PerformanceResourceTiming`；
2. 右下角显示「WR抓包」徽标与条目列表；
3. 提供一键导出 JSON。

**不修改任何请求或响应，不上传任何数据，不记录 Cookie / Authorization / x-wrpa 签名。**

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 均可）
2. 打开 Tampermonkey 面板 → 「添加新脚本」
3. 用 `weread-capture.user.js` 全文覆盖编辑器内容，`Ctrl + S` 保存
4. 确认脚本已启用

## 抓取步骤

1. 打开微信读书阅读页并**登录**，例如 `https://weread.qq.com/web/reader/...`
2. 右下角出现绿色「📡 WR抓包 0」徽标即表示生效
3. 打开一本**官方书城的文字 EPUB 书**（书架里排版正常的出版书；**不要**用导入的 PDF、扫描版或漫画）
4. 翻 1~2 页；最好再通过目录**跳到下一章**，让脚本捕获至少两次正文请求
5. 点击徽标展开面板，点「导出 JSON」，浏览器会下载一个 `weread-capture-*.json`
6. 把这个 JSON 发回即可

> ⚠️ 上一版抓包用的是一本 PDF 模式的书，正文走的是 `/cos/download` 下载 PDF，根本没有章节 HTML 请求。**请换一本文字排版的书。**

## 怎么判断这次抓对了

导出后看两处：

- `snapshot.reader.chapterInfos` 是否有值（文字书应能读到完整目录）
- `entries` 里是否出现 URL 含 `chapter` / `content`、响应体较大的条目（面板里显示为绿色高亮行）

如果 `snapshot.workers` 有记录但没有任何正文请求，说明正文很可能在 Worker 内部抓取；请把 JSON 发回，我们再升级钩子。
如果 `snapshot.iframes` 里有 `/web/reader` 之类的 iframe，说明阅读器被放进了 iframe，需要调整 `@noframes`。

## 面板说明

| 元素 | 说明 |
| --- | --- |
| 徽标数字 | 已捕获的请求总数 |
| 高亮行（绿色） | 疑似正文接口（URL 含 chapter/content 且响应较大） |
| 「只看候选」 | 过滤掉静态资源、埋点等噪音 |
| 点击任意行 | 下方显示该条请求的详情（URL、headers、body 前 3000 字） |
| 导出 JSON | 完整数据（每条正文最多保留 256KB，总计 12MB） |
| 暂停 / 清空 | 暂停记录 / 清空已捕获 |

## 导出内容

```jsonc
{
  "script": "weread-capture-debug",
  "version": "0.1.0",
  "exportedAt": "2026-11-20T...",
  "snapshot": {
    "pathInfoId": "9cd42...",
    "topKeys": ["reader", "user", "..."],
    "readerKeys": ["bookInfo", "chapterInfos", "..."],
    "reader": {
      // bookInfo、chapterInfos、currentChapter、progress、pdfUrl
    },
    "workers": [{ "url": "blob:...", "type": "module" }],
    "iframes": ["https://weread.qq.com/..."],
    "storageKeys": { "local": ["..."], "session": ["..."] }
  },
  "entries": [
    {
      "kind": "fetch|xhr|worker|resource",
      "method": "POST",
      "url": "https://weread.qq.com/web/book/chapter/...",
      "status": 200,
      "reqHeaders": { "content-type": "application/json" },
      "reqBody": "{\"bookId\":\"...\",\"chapterUid\":35}",
      "contentType": "application/json",
      "body": "…响应前 256KB…",
      "bodyLength": 12345,
      "jsonSummary": { "html": "…结构摘要…" },
      "signed": true,
      "candidate": true,
      "likelyChapter": true
    }
  ]
}
```

## 隐私说明

- `Cookie`、`Set-Cookie`、`Authorization`、`x-wrpa-*`（请求签名）等敏感请求头**不会记录**
- `sentry-trace` / `baggage` 等追踪头会被过滤
- URL 中的 `skey` / `token` / `ticket` / `sig` / `access_token` 会被替换为 `***`
- 页面状态快照只记录 `hasSkey: true/false`，不记录 skey 本身
- 快照中的 `storageKeys` 只有 key 名，没有值
- 响应文本可能包含少量书籍正文（每条最多 256KB），仅用于确认接口结构
- 数据只存在于当前页面内存，导出由你手动触发

## 控制台 API

```js
__WR_CAPTURE__.entries      // 已捕获条目
__WR_CAPTURE__.export()     // 导出对象
__WR_CAPTURE__.snapshot()   // 当前页状态摘要
__WR_CAPTURE__.clear()
__WR_CAPTURE__.pause()
__WR_CAPTURE__.resume()
```

## 已知限制

- `@match https://weread.qq.com/*`，只在微信读书域内生效
- `@noframes`：只挂钩顶层页面；若阅读器被放进 iframe（看 `snapshot.iframes`），会漏掉 frame 内的请求
- Worker 只能记录构造 URL，**Worker 内部的 fetch/XHR 抓不到**；若正文走 Worker，需要进一步改造
- 只能读取页面自己发起的请求；被浏览器缓存命中而完全不发请求的情况不会产生新记录
- 二进制响应（图片、PDF）只记录大小，不记录内容
- 页面可能对已登录接口附加 `x-wrpa-*` 签名；本脚本只记录“有没有签名”，不记录签名值

## 卸载

在 Tampermonkey 里停用或删除脚本，刷新页面即可。