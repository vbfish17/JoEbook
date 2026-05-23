# DocuTranslate Workstation (JoEbook Elite Edition)

[简体中文](#zh) | [English](#en)

---

<a name="zh"></a>

## 简体中文开发与运维说明书

### 1. 系统核心功能概述
JoEbook (DocuTranslate) 文档翻译与版面级多源句对校对平台，是一款面向高保真文档排版翻译、AI 动态润色校对的专业办公工具。
- **高保持排版文档解析 (Direct Mode)**：支持 PDF、Word (docx)、Excel (xlsx)、JSON、EPUB、Markdown 和字幕 (srt) 等复杂格式的多层级骨架抽取与完美重排。
- **双栏句对对照精校 (Babel Mode - Editor)**：独创双栏句对协同翻译与校对模式。左侧以 A4 纸张页面/幻灯片 (PPTX Slide) 形式高保真模拟原版骨干，支持视觉关联；右侧提供支持多模式文本句对编辑的交互视图。
- **一键 AI 智能段落润色 (AI Polish)**：针对单个句对，支持学术化 (Formal/Refined)、口语化 (Casual/Natural) 以及精简化 (Concise) 的一键重构与翻译强化。
- **全版式双语对称预览 (Bilingual Reader Preview)**：仿真纸质左右完美对照双语装订布局，提供左右流式排版双语交叉比对预览，极速核验。
- **自定义模型拉取与自动加载**：无缝集成了内置 Gemini 3.5 共享通道，支持自填任意兼容 OpenAI/Ollama 协议的自建、第三方大模型接口 (Base URL & API Key)；配备**动态 API 模型列表拉取功能**，点击即可自动连接并获取其支持的所有模型标识以供快速载入体验。

### 2. 技术栈架构与开发运行
本应用采用**前后端全栈隔离、一键极速轻量编译**的 Modern Web 架构体系。
- **Frontend 客户端**：基于 React 18, Vite 工具链，Tailwind CSS (支持 `@import "tailwindcss"` 的极致现代性能主题) 以及 Lucide React 精美图标套件。
- **Backend 服务端**：使用高效轻量级 Express 与 Node 原生 ESM/CJS esbuild 静态自动重构引擎相绑定。全路径服务代理不仅极大程度保护了用户 API Key 等核心机密信息，还在打包时将 `server.ts` 聚拢并压缩输出为单一的 `dist/server.cjs`，从而彻底摆脱了复杂的 Node.js 运行时引入歧义和重依赖对极速启动及冷启动性能的制约。

### 3. 本地构建与快速运行指南
确保您已安装 Node.js (推荐 v18 或更高版本)。

```bash
# 1. 安装项目所有构建依赖项
npm install

# 2. 开启开发模式 (极速热重载，绑定 3000 端口，包含 API 通道与静态服务代理)
npm run dev

# 3. 编译发布版本 (自动重构客户端并为服务端文件 server.ts 生成高度聚合的 dist/server.cjs)
npm run build

# 4. 启动成品服务器 (Standalone Production Mode)
npm start
```

### 4. 环境变量配置 (`.env`)
可在项目根目录下创建 `.env` 文件。
```env
# 核心内置 Gemini 3.5 密钥
GEMINI_API_KEY=您的_GEMINI_API_KEY_在这里
```
若未配置，由于系统配备了全面的第三方扩展自调节功能，您也可以直接在前端网页右上角的 **⚙ 设置** 面板中自主配置第三方大模型的 API 密钥和接口节点。

### 5. 桌面客户端开发与 Mac DMG 极速打包发布
为了满足用户在本地电脑（尤其是 Mac 电脑）独立离线运行、无需依赖浏览器并拥有更好的桌面交互体验的需求，本工程内置了完整的 **Electron 桌面外壳容器与 DMG 打包管线**：

```bash
# 1. 启动本地 Electron 桌面客户端窗口（开发测试，无需编译成安装包）
# 该脚本会自动先运行 Express 后端，随后唤起 JoEbook 专属桌面窗口加载服务
npm run electron:start

# 2. 【核心】一键将本工程全栈应用编译打包为 Mac 原生 DMG 安装文件
# 编译完成后，DMG 文件可在 `dist-desktop/` 目录下找到，您可直接在 macOS 上安装运行测试！
npm run dist:mac

# 3. 如果需要发布为 Windows .exe 安装包，也可以运行以下命令：
npm run dist:win
```

---

<a name="en"></a>

## English Developer & Operator's Guide

### 1. Essential Features Overview
JoEbook (DocuTranslate) is an immersive, high-fidelity document translation and page-by-page interactive bilingual workspace.
- **Form-Reserving Structure Parsing (Direct Mode)**: Preserves text layout, nested blocks, and tabular formatting for complex doc types, including PDF, DOCX, XLSX, JSON, EPUB, MD, and subtitles.
- **Dual-Column splitscreen Proofreader (Babel Mode - Editor)**: A side-by-side interactive workbook. The left panel shows an adaptive mock canvas representing the source document sheet/slide skeleton (supporting PPTX slides and doc templates), and the right acts as an multi-node sentence pairs translation editor.
- **Dynamic AI Paragraph Polish**: Supports inline academic upgrading (Formal), colloquial localization (Casual), and prompt-based character reduction (Concise) using deep models.
- **Fluid Symmetrical Dual Reader Preview (Preview Mode)**: Visualizes a balanced dual-column output mirroring printed bound books to verify style, length, and position coherence.
- **Dynamic API Model Retrieval**: Connects directly to Gemini 3.5 default free-tier API endpoints, or third-party compatible nodes (DeepSeek, OpenAI, Ollama, LMStudio). Includes a **"Pull API Models" helper** which makes live requests to fetch and populate active model tag variables instantly.

### 2. Modern Stack Architecture
- **Client (Frontend)**: Structured using React 18 with Vite, styled with CSS via high-performance modern Tailwind config rules, and decorated with Lucide icons.
- **Server (Backend)**: Executed over Express.js. Designed around a fully isolated **production esbuild bundler pipeline** that compiles the TypeScript backend (`server.ts`) directly into a self-contained, lightweight CommonJS server (`dist/server.cjs`). This prevents filesystem path resolution mismatch errors inside container nodes and ensures near-instant server startup.

### 3. Local Development & Deployment Runbook
Make sure Node.js (v18 or higher recommended) is available in your environment.

```bash
# 1. Resolve and install project packages
npm install

# 2. Fire up local development environment (Live reload + full API reverse proxy binds on port 3000)
npm run dev

# 3. Compile client static SPA assets and output packaged server standalone release
npm run build

# 4. Spin up bundled standalone production server
npm start
```

### 4. Configuration Requirements (`.env`)
Populate a `.env` configuration file in your directory root:
```env
# Built-in shared Gemini API Credentials
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
```
Alternatively, if left unconfigured, developers or users can easily click the **⚙ Gear Settings** button on the top-right corner of the web application to insert their own customized base endpoints and private keys dynamically.

### 5. Desktop Application Packaging (Mac DMG)
To run JoEbook Workstation locally as a native desktop program with higher fidelity controls and standalone process wrappers, the project contains an fully-integrated **Electron + Electron-Builder pipeline**:

```bash
# 1. Run local Electron application framework during active development
npm run electron:start

# 2. Package whole full-stack workspace into a macOS DMG installer
# Built files can be accessed via the `dist-desktop/` folder instantly upon success!
npm run dist:mac

# 3. Compile standalone Windows executable installer (.exe)
npm run dist:win
```

---

### ⚠️ 关于 GitHub 仓库发布与隐私安全重要声明 / Crucial Privacy & GitHub Export Notice

> **🔒 为保障您的账户隐私和代码安全，请知悉：**
> 1. **代码安全建议**：根据平台风控与底层安全协定，AI 编码助手**在沙盒中被严格禁止以任何形式持有、记录或代传用户的 GitHub 密码、个人访问令牌(PAT)或敏感账号信息**。因此我们强烈建议并促请您立刻修改/更换该临时密码以保障账号安全。
> 2. **AI Studio 官方一键秒级导出发布**：
>    本开发环境已经全面集成了专用的官方 GitHub 一键多态安全导出工具！您只需进行以下极简操作，即可将当前已构建完毕的完美最新版本，一键存入您的私人/公有仓库中：
>    - **第一步**：点击本 AI Studio 平台最顶部的配置与状态管理栏，或右上角的 **设置 (⚙ Settings / Gear Icon)**。
>    - **第二步**：选择并点击 **导出到 GitHub (Export to GitHub / Export Repository)** 选项。
>    - **第三步**：在弹出的 GitHub 安全联接与 Oauth 页面授权您的 GitHub 账号进行授权登入绑定（该过程绝不会让第三方暴露或留存您的明文秘密，100% 安全合规）。
>    - **第四步**：创建一个全新的代码库并选择安全设定为 **私有 (Private Repo)**，一键直接导出即可！
