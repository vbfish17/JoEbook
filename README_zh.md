<div align="center">
  <br />
  <h1>🚀 JoEbook (久易)</h1>
  <p><b>智能非破坏性文档高保真排版翻译 & 双栏沉浸式极致校对工作站</b></p>

  <p>
    跨时代高保真（Form-Preserving）文档翻译底座，搭载大模型上下文句对对齐框架，重构学术 PDF、书籍与商业报告。
  </p>

  <p>
    <img src="https://img.shields.io/badge/Release-v1.2.0-blue?style=flat-square" alt="Version" />
    <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" alt="React 19" />
    <img src="https://img.shields.io/badge/TailwindCSS-v4.0-38bdf8?style=flat-square&logo=tailwindcss" alt="Tailwind CSS v4" />
    <img src="https://img.shields.io/badge/Electron-Desktop-47848F?style=flat-square&logo=electron" alt="Electron Native" />
    <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  </p>

  <p>
    <b>
      <a href="https://ais-pre-jtz4idduxc7va53lohaw7o-283544313319.us-west2.run.app">在线体验 (Live Demo)</a> · 
      <a href="./README_DEV.md">系统运维与开发者手册 (Developer Docs)</a> · 
      <a href="#-致敬借鉴与开源传承">致谢开源 (Acknowledgements)</a>
    </b>
  </p>
  <br />
</div>

---

> 📖 **[Read the English Version (阅读英文版说明)](./README.md)**

## 💡 为什么选择 JoEbook？版面重排的真正痛点

在传统的文档翻译场景中，我们常常面临“翻译格式混乱、图形排版错位、译文溢出”的普遍困境：
*   **传统翻译软件**：直接破坏原版设计，标题不居中、图表错落、页边距崩溃，翻译后的报告完全丧失“可读性”。
*   **简单截图翻译**：虽然保持了版面，但译文无法编辑校对，像素模糊，根本无法应用到学术研究或高品质学术出版中。

**JoEbook** 应运而生。它是专为学术论文（PDF）、商业报告、电子书籍等各种深度阅读场景设计的**下一代非破坏性高保真排版翻译系统**。通过对文档结构进行结构抽取与上下文感知对齐，它在不改变原生布局的前提下，替换了双语段落，并且配合着**双栏句对对照流式校对工作台**，让每一份译作都像原生稿件一样精美。

---

## 🎨 核心功能与亮点 (Key Features)

### 1. 📂 多格式非破坏性结构抽取
*   支持 **PDF、Word (.docx)、Excel (.xlsx)、EPUB、Markdown、JSON 等** 多种主流文档和数据格式。
*   安全跳过样式容器（如表格设计、浮动图表、绝对定位版式），仅对文本段落进行精准注入，保持原有行高、字体样式、排版布局。

### 2. 📑 句对双屏沉浸式极速校对工作台
*   左侧原生文档无损全景渲染与预览，右侧为句对/段落同步编辑器（支持无限次微调重刷）。
*   双侧通过文档 DOM 的映射锚点实现“点击右侧原文 -> 对应左侧排版区域呼吸高亮联动响应”，一秒解决“找不到对应配图位置”的痛点。

### 3. 🪄 AI 智能文本三重润色矩阵 
*   **学术化 (Academic)**：适合高阶文献研究与出版物级别语句重组。
*   **地道化 (Native)**：采用母语思维、对应行业专业黑话进行转译。
*   **精简化 (Concise)**：为预防排版空间溢出进行的定长自适应改写，使其正好放入 PPT / 设计稿狭窄的原版面区域内。

### 4. 🗄️ 全离线高容量 IndexedDB 数据引擎
*   完全丢弃 LocalStorage 的 5MB 配额限制。内置的 `idb-keyval` 系统可在前端秒级无缝加载/缓存几百MB级包含大量图片的翻译工程历史，避免进程或标签页崩溃导致数据丢失。

### 5. 🚀 大容量文档批量智能排版翻译
*   最多允许用户挂载 10 份大中型分析报告实现队列轮询翻译（基于您的 API 并发能力，或后端请求队列机制）。单文件支持高达 200MB 的分析极限。不受环境断网影响（依靠状态机重新继续任务）。

### 6. 💻 Electron 原生客户端桌面体验
*   自带 macOS 原生多平台打包套件，享受操作系统底层的计算支持与文件的高速流式读写体验。

---

## 🛠️ 本地编译与部署 (Getting Started)

1. **安装环境**：Node.js v18.0.0+ 
2. **下载代码**：`git clone https://github.com/vbfish17/JoEbook.git && cd JoEbook`
3. **依赖安装**：`npm install`
4. **启动开发**：`npm run dev` （在浏览器访问 `http://localhost:3000`）
5. **部署发布**：`npm run build` & `npm run start` （自带全量化打包流程配置，直接出产服务端部署包）

---

## 💖 致敬、借鉴与开源传承

本产品核心机制与解析器设计，深深致敬并使用了以下卓越的开源项目：
1. **[yihong0618/bilingual_book_maker](https://github.com/yihong0618/bilingual_book_maker)** - 指引了非破坏性段落插补、大块结构标签重组的最重要思想，拓宽了双语书籍翻译的视野。
2. **[hopding/pdf-lib](https://github.com/hopding/pdf-lib)** - 基于此工具，我们实现了文档中高级元素的纯净解析。
3. **[mozilla/pdf.js](https://github.com/mozilla/pdf.js)** - PDF 文本排版的锚点高亮联动的物理实现灵感源泉。
4. **[kovidgoyal/calibre](https://github.com/kovidgoyal/calibre)** - 我们设计各种边界容错解析规则的百科全书指南。
5. **[jgm/pandoc](https://github.com/jgm/pandoc)** - 关于“通用中间抽象树 (AST)”的伟大哲学，极大启发了多文档流自适应解析器的构建逻辑。

---

## 🔒 开源协议与路线规划

*   本项目选用 **MIT 许可证** 开放运行，这意味着您可以极度自由地使用、定制、研究或集成到您自己的商业系统中，无需拘束。
*   **近期路线 (Roadmap)**：
    1.  [x] 完成 PDF/DOCX 双芯双语输出及句对高仿真对照校对
    2.  [x] 基于 `idb-keyval` 重构无封顶离线工程快照与断点存储机制
    3.  [ ] 支持大型扫描版 PDF 的端侧 OCR 提取及版面重划分模块集成
    4.  [ ] 支持基于矢量算力的本地移动端 EPUB/PDF 双版排版高精度重构

---

*“开源不仅是代码的合并与拼装，更是智慧的共振与致敬。”感谢每一位为开源社区添砖加瓦的建设者。*

<br/>

*欢迎提出反馈与建议。*
