# 微信读书·微信模式

把微信读书网页版伪装成**微信桌面版**的 Tampermonkey 脚本。

当前是 **M4：真实日志与 IDE 伪装**阶段——左栏可一键切成“工作目录”IDE 树（项目/分支/文件类型/Git 状态）；右栏用微信"文件消息"卡片打开导入的 PDF，PDF.js 白底贴边渲染，右侧日志栏优先接入 Grafana Loki 真实日志，失败时回退模拟。

> 灵感与 UI 架构参考 [xhs-wechat-mode](https://github.com/jjb4150/xhs-wechat-mode)（作者 junbiaojin）与《Chiphell 微信模式》（作者 Codex，MIT）。本项目数据层针对微信读书重新实现。

## 当前范围（M4）

- 只在 `/web/reader/*` 且检测到 **PDF 管线**时接管：
  - `__INITIAL_STATE__.reader.pdfUrl` 非空
  - 页面请求体出现 `"fm":"pdf"`
  - 捕获到 `/cos/download?getUrl=1&bookId=CB_...`
  - DOM 中出现 PDF 查看器/画布
- 左栏：本地记录过的 PDF 书 + 书架接口里能确认是 PDF 的书
- **工作模式伪装**：点击左栏顶部“微信读书”四个字，切换成“工作目录”
  - 左栏是 IDE 风格工作区：项目名、分支下拉（main/develop/…）、嵌套 Java 工程树、文件类型徽标、Git 状态
  - 工作区可以整体折叠；文件夹可展开/折叠；文件可选中
  - 右侧标题、文件卡片、预览栏文件名统一替换为 `design-spec.pdf`
  - 标签页标题变为 `design-spec.pdf · 工作目录`
  - 工作模式会记住，刷新后保持；点“工作目录”四个字切回微信书架
- 右栏：微信式文件消息卡片（`书名.pdf`，工作模式下显示工作文档名）
- 预览：`GM_xmlhttpRequest` 取 PDF 字节，交给 **PDF.js** 在右栏内渲染
  - PDF 区域白底、无边框/阴影，页面默认 100% 贴边铺满
  - 右侧固定“运行日志”栏，铺满高度；优先接入 Grafana Loki 真实日志（显示「实时」），未登录或失败时回退模拟日志（显示「模拟 / 未登录」）
  - 点「日志」可收起日志栏，PDF 区域自动重新适配
  - 工具栏：返回、上一页/下一页、页码跳转、缩放 −/+/适应宽度、日志开关
  - 左栏与日志栏之间有拖动分隔条，宽度可调并记住
  - 点击右栏顶部书名（预览中为顶部文件名）隐藏阅读区，日志铺满右栏；再点恢复，状态会记住
  - 支持滚动、懒加载页面；ESC 返回聊天流
- 退出：顶栏 ⏏；退出后右下角绿色悬浮球可随时回来
- 窄屏（< 1000px）：不接管，保持官方阅读器

**M4 不做**：文字书气泡阅读、划线/想法/评论、字号缩放、暗黑模式、左右栏拖拽、PDF 文字选择/搜索。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 新建脚本，把 `weread-wechat-mode.user.js` 全文粘贴进去，`Ctrl + S` 保存
3. 脚本通过 `@require` 从 jsDelivr 加载 PDF.js 和 pdf.worker（首次需要联网），Tampermonkey 可能提示跨域权限，允许即可
4. 打开微信读书并登录，进入一本**导入的 PDF 书**的阅读页
5. 检测成功后页面自动变成微信外壳；控制台过滤 `[微信读书·微信模式]` 可看日志

## 使用

- 拖动左栏右侧或日志栏左侧的分隔条调整宽度（会自动记住）
- 点击右栏顶部书名 / 预览顶部文件名切换“只看日志”模式
- 油猴菜单「设置 Grafana Token」：粘贴 Grafana Service Account Token，改用 Bearer 鉴权（不依赖 cookie）；「清除 Grafana Token」恢复使用浏览器登录态
- 点击左栏顶部“微信读书”/“工作目录”切换伪装模式
- 左栏点击书籍切换（会整页跳到该书的阅读页）
- 右栏点击「书名.pdf」卡片 → 打开自建阅读器
- 顶部工具栏：返回、翻页、页码跳转、缩放、适应宽度、日志开关
- 阅读区滚动查看页面；页面懒加载
- 顶栏 `⏏` 退出微信模式；右下角悬浮球回来
- 油猴菜单：进入/退出微信模式、刷新书架

## 数据与兼容

| 数据 | 来源 |
| --- | --- |
| 当前书信息/封面 | 阅读页 SSR 的 `__INITIAL_STATE__.reader.bookInfo` |
| 是否 PDF | `pdfUrl` / `fm=pdf` 请求体 / `/cos/download` 请求 / PDF DOM |
| 导入书 ID | 从阅读页 URL 的 `infoId` 反解（`CB_...`），或从 `/cos/download` 捕获 |
| PDF 地址 | 复用页面捕获的 `/cos/download` 响应；过期时用 `bookId` 重新请求 |
| PDF 字节 | `GM_xmlhttpRequest` 跨域下载（`@connect *`） |
| PDF 渲染 | PDF.js 3.11（`@require` CDN）；worker 也通过 `@require` 注入，优先主线程 worker，避免站点 CSP 拦截 |
| 真实日志 | Grafana Loki：`{job="ttigd-manage-web"}`，datasource `d326ce70…`，通过 `GM_xmlhttpRequest` 带 Grafana 登录态请求 |
| 模拟日志 | Grafana 未登录/不可用时本地生成；日志栏状态显示「模拟」或「未登录」 |
| 工作目录伪装 | 文件树、工作文档名、标签页标题均为本地伪造 |
| 书架 | `GET /web/shelf/sync?synckey=0&teenmode=0&aid=0`，字段未知时降级为本地记录 |

书架接口的字段尚未用真实登录态确认。脚本会：

- 在控制台打印书架首条的字段名（不打印值）
- 只纳入能确认 `format=pdf` / `isPdf` 的书
- 始终把"当前正在读的 PDF 书"放进左栏
- 把打开过的 PDF 书记在本地（最多 30 本），下次直接出现在左栏

## 已知限制

- 签名 PDF 地址有效期很短；预览打开时会尝试重新获取
- PDF 由 `GM_xmlhttpRequest` 整份下载后再渲染，大文件首次打开需要等待（有进度提示），内存占用与文件大小相当
- PDF.js 与 pdf.worker 从 CDN `@require`；若脚本管理器无法加载 @require，会依次回退到 CDN Worker / Blob Worker / 运行时注入
- CMaps / 标准字体也走 CDN；个别 PDF 的字体可能显示不完整
- PDF 文字不可选、不可搜索（自绘 canvas）；页级进度暂未持久化
- 真实日志默认使用浏览器里的 Grafana 登录态；若被跨站 cookie 策略拦截，脚本会自动回退模拟日志
- 更稳的方式：创建一个 Grafana Service Account（Viewer 角色）并生成 Token，在油猴菜单「设置 Grafana Token」中粘贴；Token 只保存在本地 Tampermonkey 存储，只发送给 `igfa.dcgstd.cn`
- 未登录时点击日志栏的「未登录」可直接打开 Grafana 登录
- Grafana 接口/查询写死在脚本常量里（`REAL_LOGS`），如 job 或 datasource 变化需要改脚本
- 若单位不允许创建 Service Account Token，且浏览器不允许跨站 cookie，可改用本地代理转发 Loki；需要另起一个本地服务
- 日志栏宽度范围 `220–900px`；PDF 最小缩放 10%，最小页宽 40px
- 工作模式只伪装界面文字；PDF 页面本身的内容仍可能是书页
- 工作模式会修改浏览器标签页标题，退出微信模式或切回书架时恢复
- “只看日志”状态会持久化；点击右栏顶部书名即可切回阅读区
- 书架条目若没有可用阅读链接，会显示为不可点击，需要先在官方书架打开一次
- 接管时用 `opacity:0` 隐藏官方界面（保留挂载），避免破坏其内部状态

## 调试

```js
__WR_CHAT_MODE__.ctx        // 当前接管上下文
__WR_CHAT_MODE__.detect()   // 手动执行 PDF 检测
__WR_CHAT_MODE__.enter()    // 进入
__WR_CHAT_MODE__.exit()     // 退出
__WR_CHAT_MODE__.refreshShelf()
```

## 路线图

- **M1**：微信外壳 + PDF 检测 + 左栏 + 文件卡片 + 右栏预览
- **M2**：PDF.js 自建阅读器 + 右侧日志栏 + 缩放/页码/日志开关
- **M3**：白底贴边、日志栏加宽、工作目录伪装、左右栏可拖拽、只看日志
- **M4**（当前）：Grafana 真实日志、IDE 风格工作树、更极端的缩放/宽度范围
- **M5**：暗黑模式、字号、键盘、PDF 页级进度记忆
- **v1.1**：文字 EPUB 气泡流 + 自动续章 + 本地进度（需先完成正文接口抓包）

抓包工具在 [`tools/`](tools/)，用于定位文字书正文接口。

## 许可

MIT。UI 架构署名见文件头与 [LICENSE](LICENSE)。