# 微信模式 / 工作模式 — 多站点复用蓝图

> 把「网页内容」重排成「微信桌面版」或「工作台」，同时保留一条工作日志栏。
> 本文是当前 `weread-wechat-mode` 的抽象版设计，用于 linux.do、小红书、Chiphell、知乎、虎扑、微博等站点的新项目。

---

## 0. 一句话定义

> **不重写目标网站，只重排当前页已经拿到的内容。**
> 用一个可复用的「外壳」承载任意站的「内容适配器」；阅读区、会话列表、工作目录、日志栏都只是外壳的插槽。

核心原则：

1. **只读优先**：不伪造签名、不绕过付费/登录、不批量抓取，只展示当前账号本来就能看到的内容。
2. **外壳与数据解耦**：新站点只写适配器，不重写 UI。
3. **可退出**：任何接管都要有明确的退出入口和悬浮球恢复。
4. **失败不接管**：识别不了或内容取不到时，保持官网原样，宁可不生效也不要半成品。

---

## 1. 三个区域与两个切换

```
┌───────────────┬──────────────────────────────┬──────────────────┐
│  左栏          │  阅读区 / 内容区               │  日志栏           │
│                │                              │                  │
│  微信模式：     │  微信模式：                   │  运行日志         │
│  会话 / 书 /    │  文件卡片、聊天气泡、          │  实时 / 模拟      │
│  帖子列表       │  白色文档、PDF/图片            │  可收起           │
│                │                              │                  │
│  工作模式：     │  同一块区域，只是内容换了皮      │  同一块日志       │
│  IDE 文件树     │                              │                  │
└───────────────┴──────────────────────────────┴──────────────────┘
        ↑ 点击标题切换            ↑ Ctrl+Alt+Q 切换阅读/日志
```

### 1.1 两个切换

| 切换 | 触发 | 效果 |
| --- | --- | --- |
| 微信 ↔ 工作目录 | 点击左栏顶部标题（如“微信读书” / “工作目录”） | 左栏换成 IDE 文件树；右栏标题、文件名、标签页标题/图标换成工作文档 |
| 阅读区 ↔ 日志占满 | `Ctrl+Alt+Q`（可在配置中修改）或点击书名/文件名 | 隐藏中间阅读区，日志栏铺满右栏；再按恢复 |

### 1.2 可调宽度

- 左栏与中栏之间、中栏与日志栏之间各有一条 **1px 可见分隔线 + 7px 透明拖拽热区**。
- 宽度写入本地存储；日志栏最宽可到「右栏宽度 - 60px」，中栏最小约 60px。
- 拖动时只做轻量重排；PDF 类内容在松手后再重渲染。

---

## 2. 视觉规范（设计令牌）

### 2.1 微信外壳（浅色）

| 令牌 | 值 |
| --- | --- |
| 左栏背景 | `#f7f7f7` |
| 右侧阅读区背景 | `#fff` |
| 会话分割线 | `#e2e2e2` |
| 主文字 | `#191919` |
| 次级文字 | `#999` |
| 强调绿 | `#07c160` |
| 左气泡 | `#fff`，圆角 4px，轻阴影 |
| 自己的气泡 | `#95ec69`（当前微信读书版未使用，留给聊天型站点） |
| 正文字号 | 17px / 行高 1.9 / 系统黑体 |
| 顶栏 | 44–60px，浅色，底部 1px 分割线 |

### 2.2 工作目录（IDE 观感）

- 项目名 + 分支下拉 + 文件树 + 文件类型徽标 + Git 状态（M/U/D）。
- 文件树用等宽字体；文件夹可展开/折叠；工作区可整体折叠。
- 底部状态：`Java 17 · Maven · main` 之类。
- 日志栏：浅灰背景、等宽 11px、级别彩色（INFO 绿、WARN 橙、ERROR 红）。
- 工作文档名：`design-spec.pdf` 这类通用名；标签页标题 `design-spec.pdf · 工作目录`。

### 2.3 两条“封面故事”

未来项目建议把封面故事做成配置，而不是写死：

```ts
interface CoverStory {
  id: string;                 // "frontend" | "java-backend" | "devops"
  workspace: string;          // ttigd-manage-web
  branch: string;             // main
  branches: string[];         // main / develop / release/...
  tree: WorkTree;             // 文件树数据
  footer: string;             // Java 17 · Maven · main
  fakeDocName: string;        // design-spec.pdf
  tabTitle: string;           // design-spec.pdf · 工作目录
  favicon?: string;           // data URI
  vocabulary: Record<string, string>; // 敏感词 -> 工作词
}
```

例如：

- linux.do：`community-service`、`api-gateway`、`release/2026.11`。
- 知乎：`research-notes`、`knowledge-base`。
- 小红书：`content-pipeline`、`media-service`。
- 微博：`feed-service`、`timeline-api`。

---

## 3. 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Shell (core)                        │
│  左栏容器 / 中栏容器 / 日志栏 / 拖拽 / 标题 / 悬浮球 / 快捷键   │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
       ┌───────▼────────┐        ┌────────▼────────┐
       │  SiteAdapter    │        │   LogProvider    │
       │  站点内容适配器   │        │  日志数据源      │
       └───────┬────────┘        └────────┬────────┘
               │                          │
       ┌───────▼────────┐        ┌────────▼────────┐
       │  Normalized     │        │  LogEntry[]     │
       │  Conversation/  │        │  status         │
       │  ContentBlock   │        └─────────────────┘
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │   Renderers     │
       │  document /     │
       │  bubbles / pdf /│
       │  gallery        │
       └────────────────┘
```

> **适配器只负责“拿什么”和“怎么翻页”，不负责“长什么样”。**
> 外壳统一处理视觉、布局、快捷键、日志、工作伪装。

---

## 4. 适配器接口（建议 TypeScript）

```ts
export type ContentKind = "document" | "bubbles" | "pdf" | "gallery";

export interface Conversation {
  id: string;
  title: string;
  subtitle?: string;
  avatar?: string;          // 封面/头像
  updatedAt?: number;
  unread?: boolean;
  badge?: "PDF" | "EPUB" | "帖子" | "回答" | string;
}

export interface ContentBlock {
  type: "heading" | "paragraph" | "image" | "code" | "table" | "quote" | "divider" | "html";
  text?: string;
  html?: string;            // 已由适配器清洗/受限
  src?: string;
  alt?: string;
  level?: number;
  language?: string;
  rows?: string[][];
}

export interface ContentView {
  title: string;
  author?: string;
  blocks: ContentBlock[];
  html?: string;            // 站点原文 HTML（core 再清洗）
  css?: string;             // 受控样式（Shadow DOM 内）
  nextId?: string;
  prevId?: string;
  kind: ContentKind;
}

export interface SiteAdapter {
  id: string;                       // "linuxdo" | "zhihu" | ...
  label: string;

  matches(url: URL): boolean;
  /** 页面就绪后探测是否是受支持的页面；返回 null 表示不接管 */
  detect(): Promise<SiteContext | null>;

  /** 左栏会话 / 帖子 / 书 / 主题 */
  listConversations(ctx: SiteContext): Promise<Conversation[]>;

  /** 打开一条会话，返回可渲染的内容 */
  openConversation(id: string): Promise<ContentView>;

  /** 可选：下一页/下一章 */
  loadNext?(id: string): Promise<ContentView | null>;
  loadPrev?(id: string): Promise<ContentView | null>;

  /** 可选：当前站点可用的日志数据源 */
  createLogProvider?(ctx: SiteContext): LogProvider | null;
}

export interface SiteContext {
  site: string;
  url: string;
  canonicalId: string;      // 用于路由变化判断，不要把章节/页码算进去
  title: string;
  author?: string;
  cover?: string;
  kind: ContentKind;
}
```

### 4.1 适配器的数据来源策略（按优先级）

1. **SSR / 首屏状态**：`__INITIAL_STATE__`、`__NUXT__`、`window.__DATA__`。
2. **页面已渲染 DOM**：挑内容容器，读段落/图片/表格。
3. **同源只读 API**：带 cookie，只发页面本来就会发的读请求。
4. **挂页面自己的请求**：在 `document-start` 钩 `fetch`/XHR，复用页面自己签名的响应（当前 EPUB 就是这个思路），绝不自己伪造签名。
5. **驱动官方 UI**：隐藏/离屏保留官网，程序化点击目录/下一页/加载更多；接受官方进度可能被改变。
6. 以上都不行 → **不接管**，保持官网。

> 对知乎/微博这类有 `x-zse-96`、XSRF 的站点，优先第 2/4 条：读页面已有内容或复用页面自己的请求，不要逆向签名。

---

## 5. 检测、接管与恢复

### 5.1 检测

- URL 匹配（站点 + 页面类型）。
- 内容标记：主题列表、帖子容器、正文容器、目录按钮等。
- 能力探测：试取第一条内容；拿不到就不接管。
- **宽限期**：进入阅读页后等 1.5–3 秒，让“PDF/特殊管线”等信号先出现，避免误判。
- 识别结果写入 `SiteContext`；不支持的页面直接返回。

### 5.2 接管

- 不销毁官网：给顶层容器 `opacity: 0; pointer-events: none`，保持挂载，便于：
  - 保留登录态；
  - 复用站点自己的请求/渲染；
  - 退出时无损恢复。
- 新外壳放在 Shadow DOM 中，隔离站点 CSS。
- 顶部 ⏏ 退出；右下角绿色悬浮球可回来。
- 退出状态持久化；下次打开阅读页可以只显示悬浮球。

### 5.3 路由

- SPA 用 1 秒轮询或 `history.pushState` 钩子。
- 比较 **canonical ID**（书籍 infoId、帖子 ID、问题 ID），**不要比较章节/页码/查询串**。
- 章节/分页变化只更新内容，不重建外壳。

---

## 6. 日志系统

日志栏是“工作伪装”的核心，也是独立可复用组件。

### 6.1 两种来源

```ts
interface LogProvider {
  id: string;
  label: string;
  start(sink: LogSink): void | (() => void);
  stop?(): void;
}

interface LogSink {
  reset(): void;
  line(entry: LogEntry): void;
  status(state: "connecting" | "live" | "sim" | "unauth" | "offline"): void;
}

interface LogEntry {
  ts: number;
  level: "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";
  service: string;
  message: string;
}
```

- **模拟日志**：本地模板 + 定时追加，永远可用，作为兜底。
- **真实日志**：当前是 Grafana Loki；新项目可扩展：
  - 通用 HTTP 日志接口；
  - WebSocket；
  - 本地文件/本地代理；
  - 站点自己的活动流（不推荐，容易泄露正在浏览的内容）。

### 6.2 状态与回退

| 状态 | 含义 |
| --- | --- |
| 实时 | 真实日志连接成功 |
| 未登录 | 401/403；保留模拟日志；点击状态打开登录页 |
| 模拟 | 网络/接口失败；继续模拟 |
| 离线 | 曾经连上、后续失败；保留最后一批真实日志 |

- 失败后 30 秒重试；成功后清除失败标记。
- Token/凭据只存本地；日志中不打印 token、cookie、正文。
- 真实日志源应可插拔；当前项目的 `REAL_LOGS` 常量应移到配置。

### 6.3 阅读区 ↔ 日志占满

- 快捷键 `Ctrl+Alt+Q`（可配置）：隐藏中间内容区，日志栏 `flex:1` 铺满。
- 未打开阅读器时，同样切换文件卡片与全屏日志。
- 输入框/文本域/`contentEditable` 聚焦时不触发。

---

## 7. 工作目录伪装

### 7.1 结构

```
工作目录
▾ ttigd-manage-web
  ▾ src
    ▾ main
      ▾ java/com/ttigd/manage
        ▾ controller
          OrderController.java   M
        ▾ service
          OrderService.java      M
  ▾ scripts
    deploy.sh
    migrate.sql                  D
  pom.xml                        M
  README.md
main ▾ · 3 changes
```

- 项目名可折叠 → 整树收起。
- 分支下拉：main / develop / release/...；切换只改显示。
- 文件类型徽标：J / GO / TS / X / Y / SH / SQL / M…
- Git 状态：M 橙、U 绿、D 红。
- 文件/文件夹可点击；文件仅高亮，不打开真实文件。

### 7.2 伪装面

| 位置 | 微信模式 | 工作模式 |
| --- | --- | --- |
| 左栏标题 | 微信读书 / 站点名 | 工作目录 |
| 左栏内容 | 会话/帖子/书 | IDE 文件树 |
| 右侧标题 | 书名/帖子标题 | `design-spec.pdf` |
| 文件卡片 | `标题.pdf/.epub` | `design-spec.pdf` |
| 阅读器标题 | 原标题 | `design-spec.pdf` |
| 标签页标题 | `标题 - 站点` | `design-spec.pdf · 工作目录` |
| 标签页图标 | 站点图标 | 蓝色文件夹 SVG |

### 7.3 敏感词映射

新项目建议内置一份“站点词 → 工作词”的映射，至少覆盖：

- 站点品牌名（小红书、知乎、微博、虎扑、Chiphell、linux.do）
- 内容形态词（笔记、帖子、回答、话题、评论、收藏）
- 书名、作者名（标题/标签页/卡片）

做不到完全隐藏页面正文，但至少不要让 UI 文字直接暴露“在刷某站”。

---

## 8. 目标站点适配矩阵

| 站点 | 页面/左栏 | 阅读区 | 推荐数据路线 | 难度 | 关键风险 |
| --- | --- | --- | --- | --- | --- |
| **linux.do** | Discourse 主题列表 | 帖子楼层 | `/latest.json`、`/t/<id>.json` 或 DOM | 低 | SPA、登录/CORS |
| **小红书** | 发现 feed / 笔记 | 正文 + 图片 + 评论 | feed DOM + 笔记页 SSR + 隐藏 iframe（参考 xhs-wechat-mode） | 高 | 签名、风控、隐藏页驱动 |
| **Chiphell** | 版块帖子列表 | 帖子楼层 | HTML DOM + 分页；必要时离屏驱动 | 中高 | 登录、反爬、图片防盗链 |
| **知乎** | 推荐/问题/回答 | 长文回答 | 页面 DOM + 页面自己的 API 响应 | 高 | `x-zse-96` 签名、风控、长文分页 |
| **虎扑** | 版块主题列表 | 帖子楼层 | HTML/DOM + 分页 | 中高 | 反爬、移动/桌面差异 |
| **微博** | 关注/推荐时间线 | 微博正文 + 评论 | 页面 DOM + 页面自己的 XHR（XSRF） | 高 | 登录、限频、动态渲染 |

### 8.1 每个站点的共同适配步骤

1. **抓包 + DOM 探针**：用 `tools/` 里的思路（或 DevTools）记录：
   - 列表项选择器、标题、封面、链接；
   - 内容容器、段落/图片/代码结构；
   - 翻页/加载更多/目录控件；
   - 是否有登录态、签名头、CORS/Worker。
2. **写 `detect`**：URL + 标记 + 能力探测；失败返回 null。
3. **写 `listConversations`**：优先 SSR/API，其次 DOM。
4. **写 `openConversation`**：DOM 或页面自有请求；标准化为 `ContentBlock[]`。
5. **接入日志**：先模拟日志；有 Grafana/Loki 或本地日志再替换。
6. **配置封面故事**：项目名、分支、文件树、假文档名、敏感词。
7. **回归**：退出/恢复、路由切换、翻页、输入框快捷键保护。

### 8.2 推荐的渲染器

| 内容 | 渲染器 |
| --- | --- |
| 知乎长回答、linux.do 楼层、Chiphell 帖子 | `document`（白色文档，接近当前 EPUB/PDF） |
| 小红书笔记、微博、评论区 | `bubbles`（聊天气泡；正文/评论） |
| PDF / 扫描版 | `pdf`（PDF.js，文件卡片 + 页视图） |
| 漫画/图片帖 | `gallery`（每页/每图一条图片消息） |

> 当前微信读书项目已验证 `document`、`pdf`；`bubbles` 可按参考项目 xhs-wechat-mode 的会话/气泡思路扩展。

---

## 9. 新项目工程结构建议

多站点后，不建议继续把所有逻辑塞进一个 `.user.js`。推荐 **monorepo + 每站单文件产物**：

```
packages/
  core/
    src/
      shell/            # 三栏、顶栏、拖拽、悬浮球、退出
      log/              # 日志栏、LogProvider、模拟日志
      workmode/         # 工作目录树、封面故事、标题/图标替换
      render/           # document / bubbles / pdf / gallery
      runtime/          # 检测、接管、路由、快捷键
      storage/          # GM 封装、命名空间
      settings/         # 设置面板 / 菜单命令
      styles/           # 设计令牌与主题
  adapters/
    linuxdo/
    xhs/
    chiphell/
    zhihu/
    hupu/
    weibo/
    weread/             # 当前项目可作为参考适配器
  build/
    userscript.ts       # esbuild/Vite 打包为单文件
tools/
  capture/              # 站点请求与 DOM 探针
docs/
  MODE-BLUEPRINT.md
```

### 9.1 构建

- 每个适配器对应一个 `userscript.config.ts`：`@match`、`@name`、`@grant`、`@connect`、`@require`（如 PDF.js）。
- `esbuild` 打成一个 `.user.js`，CSS 以字符串内联，运行时零依赖（PDF.js 可选 CDN @require）。
- 产物仍保持“单文件、可直接粘贴 Tampermonkey”，但源码可复用。
- 版本策略：core 独立版本；每个站点脚本记录 `coreVersion` 与 `adapterVersion`。

### 9.2 运行时生命周期

```
安装/注入
  → document-start 安装请求钩子（只读）
  → DOM ready → adapter.detect()
  → 成功 → Shell.mount(context)
  → adapter.listConversations() → 左栏
  → adapter.openConversation(id) → 渲染
  → 路由/翻页 → 更新内容，不重建 Shell
  → 退出 → 恢复官网 → 悬浮球
```

### 9.3 存储命名空间

```
wm:<site>:enabled
wm:<site>:leftWidth
wm:<site>:logWidth
wm:<site>:workMode
wm:<site>:logsOnly
wm:<site>:coverStory
wm:<site>:lastConversation
wm:global:loglevel
```

---

## 10. 从当前微信读书项目迁移

### 10.1 直接可复用的部分

- `ensureRoot` / 三栏 DOM / `.wr-*` 样式令牌
- `bindHorizontalDrag` / `applyLeftWidth` / `applyLogWidth`
- 顶栏、返回按钮、日志开关、只看日志（`.wr-pv.logs-only`）
- 工作目录：`WORK_TREE`、`workTreeHtml`、分支下拉、`.wr-node` 样式
- 封面故事：`applyWorkMode`、`applyWorkFavicon`、`updateDocumentTitle`
- 日志：`startWorkLogs`、`appendLogLines`、`attachRealLogs`、状态回退
- 接管/退出/路由：`mount`、`teardown`、`watchRoute`（按 canonical ID）
- 工具：`escapeHtml`、`clamp`、`delay`、`toast`

### 10.2 属于 weread 适配器的部分

- PDF 检测与 `detectPdf`、`/cos/download`、PDF.js 下载/渲染
- EPUB 检测、`/web/book/chapter/e_N` 分片解码、官方目录驱动
- 书架 `/web/shelf/sync` 与本地书缓存
- Grafana Loki 查询（可抽成通用 `GrafanaLogProvider`）

### 10.3 抽取顺序

1. 先抽 **Shell + 日志 + 工作目录**（无站点依赖）。
2. 把 weread 现有 UI 改成 core 的 `document`/`pdf` 渲染器。
3. 用 **linux.do** 做第一个新适配器（Discourse JSON 最简单）。
4. 再做 **Chiphell / 虎扑**（论坛 HTML）。
5. 知乎/微博：先做 DOM/页面自有请求，不碰签名。
6. 小红书：直接参考 `xhs-wechat-mode` 的 feed DOM + 隐藏 iframe。

---

## 11. 测试与验收清单

每个站点上线前至少验证：

- [ ] 识别：支持的页面自动接管；不支持的页面保持原样
- [ ] 左栏：列表、封面、标题、未读/时间、点击切换
- [ ] 阅读区：正文、图片、代码/表格、长文滚动
- [ ] 翻页/加载更多/章节切换
- [ ] 日志：模拟可用；真实日志状态与回退；登录态失败提示
- [ ] 工作模式：左栏/标题/文件名/标签页/图标全部切换；再点恢复
- [ ] `Ctrl+Alt+Q`：阅读区 ↔ 日志；输入框内不触发
- [ ] 拖拽：左右宽度、持久化、窗口缩放
- [ ] 退出：⏏、悬浮球、刷新后状态
- [ ] 窄屏：不接管
- [ ] 路由：SPA 切换、章节变化不重建
- [ ] 控制台无异常；失败时有明确日志

测试手段：

- jsdom + MockAdapter + MockLogProvider（当前项目已用）
- Playwright 可选：真实登录态、截图对比
- 每个站点保留一个 `fixture`：列表 JSON、内容 HTML、DOM 片段

---

## 12. 合规与安全底线

- **只展示当前账号本来能看到的内容**；不绕过付费、DRM、登录墙。
- **不伪造签名、不逆向风控参数**；优先读页面已有 DOM / 复用页面自己的请求。
- **不批量爬取**；只在用户打开的页面内按需加载，尊重站点限频。
- **不上传内容**；日志、正文、Token 都只留在本地。
- Token / 凭据只存本地 GM 存储；日志中不打印。
- 渲染第三方 HTML 时：剥离 `<script>`、`on*` 事件、危险 URL；优先 Shadow DOM 隔离。
- 公开发布时：使用中性项目名，注明“个人阅读/界面重排工具”，不暗示与站点官方有关联。
- 工作伪装是个人界面偏好；使用者需自行遵守所在组织的设备与网络使用规定。

---

## 13. 路线图

| 阶段 | 目标 |
| --- | --- |
| P0 | 抽 core（Shell / 日志 / 工作目录 / 快捷键 / 存储） |
| P1 | linux.do 适配器（验证多站点架构） |
| P2 | Chiphell / 虎扑（论坛 HTML + 分页） |
| P3 | 知乎 / 微博（SPA + 页面自有请求） |
| P4 | 小红书（移植 xhs-wechat-mode 的 feed/详情） |
| P5 | 设置面板（封面故事、快捷键、日志源、主题） |

---

## 附录 A：当前项目文件参考

| 文件 | 内容 |
| --- | --- |
| `weread-wechat-mode.user.js` | 单文件实现：外壳、PDF/EPUB 适配器、日志、工作目录 |
| `tools/weread-capture.user.js` | 只读抓包器：定位签名接口、章节分片、DOM |
| `README.md` | 当前功能与已知限制 |
| `CHANGELOG.md` | 版本记录 |
| `docs/MODE-BLUEPRINT.md` | 本文 |

## 附录 B：新站点适配检查表

1. 列表项选择器 / 数据结构
2. 内容容器 / 段落 / 图片 / 代码
3. 翻页、加载更多、目录、章节
4. 登录态、签名、CORS、Worker
5. 是否需要驱动官网（离屏 iframe / 隐藏挂载）
6. 左栏会话字段（标题、封面、时间、未读）
7. 日志源（模拟 / Grafana / 本地代理）
8. 封面故事（项目名、分支、文件树、假文档名、敏感词）
9. 退出/恢复/路由/窄屏
10. 测试 fixture 与验收记录