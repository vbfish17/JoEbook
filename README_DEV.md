# JoEbook Developer Guide

[简体中文](#zh) | [English](#en)

---

<a name="zh"></a>

## 简体中文开发与运维说明书

### 1. 系统核心功能概述
JoEbook 是一款面向高保真文档排版翻译、双语校对与桌面交付的专业工具。
- **高保持排版文档解析 (Direct Mode)**：支持 PDF、Word (docx)、Excel (xlsx)、JSON、EPUB、Markdown 和字幕 (srt) 等复杂格式的多层级骨架抽取与重排。
- **双栏句对对照精校 (Babel Mode - Editor)**：左侧展示原文档版面结构，右侧提供句对编辑与校对视图，适合逐页复核与精修。
- **一键 AI 智能段落润色 (AI Polish)**：支持学术化、口语化与精简化改写。
- **全版式双语对称预览 (Bilingual Reader Preview)**：用于检查双语排版、长度与位置一致性。
- **自定义模型接入**：支持 Gemini 及兼容 OpenAI/Ollama 协议的第三方或本地模型接口。

### 2. 技术栈架构与开发运行
本应用采用前后端分离的全栈架构。
- **Frontend 客户端**：React、Vite、Tailwind CSS、Lucide React。
- **Backend 服务端**：Express + TypeScript，并通过 esbuild 将 `server.ts` 打包为 `dist/server.cjs`。

### 3. 本地构建与快速运行指南
确保您已安装 Node.js 18 或更高版本。

```bash
# 1. 安装项目依赖
npm install --include=dev

# 2. 开启开发模式
npm run dev

# 3. 构建发布版本
npm run build

# 4. 启动生产服务
npm start
```

### 4. 环境变量配置 (`.env`)
可在项目根目录下创建 `.env` 文件。

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
```

若未配置共享密钥，用户也可以在前端设置面板中填写自己的模型接口信息。

### 5. 桌面客户端开发与 Mac DMG 打包
本工程内置 Electron 桌面外壳与 DMG 打包流程：

```bash
# 1. 启动本地 Electron 桌面客户端
npm run electron:start

# 2. 打包 macOS DMG
npm run dist:mac

# 3. 打包 Windows 安装程序
npm run dist:win
```

打包产物输出到 `dist-desktop/` 目录。

---

<a name="en"></a>

## English Developer & Operator's Guide

### 1. Essential Features Overview
JoEbook is a professional workspace for structure-preserving document translation, bilingual review, and desktop delivery.
- **Form-Preserving Structure Parsing (Direct Mode)**: Supports PDF, DOCX, XLSX, JSON, EPUB, Markdown, and subtitle files.
- **Dual-Column Proofreader (Babel Mode - Editor)**: The left side shows source layout structure while the right side provides editable bilingual review panels.
- **AI Paragraph Polish**: Supports formal, casual, and concise rewriting.
- **Bilingual Preview**: Helps verify layout consistency, length, and placement.
- **Custom Model Connectivity**: Supports Gemini and third-party or local providers through OpenAI-compatible or Ollama-style endpoints.

### 2. Modern Stack Architecture
- **Frontend**: React, Vite, Tailwind CSS, Lucide React.
- **Backend**: Express + TypeScript, bundled from `server.ts` into `dist/server.cjs` via esbuild.

### 3. Local Development & Deployment Runbook
Use Node.js 18 or newer.

```bash
# 1. Install dependencies
npm install --include=dev

# 2. Start development mode
npm run dev

# 3. Build production assets
npm run build

# 4. Start production server
npm start
```

### 4. Configuration Requirements (`.env`)
Create a `.env` file in the project root when needed:

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
```

If no shared key is configured, users can still enter their own provider credentials in the application UI.

### 5. Desktop Application Packaging (Mac DMG)
JoEbook includes an Electron desktop shell and DMG packaging pipeline:

```bash
# 1. Start Electron locally for development
npm run electron:start

# 2. Build a macOS DMG package
npm run dist:mac

# 3. Build a Windows installer
npm run dist:win
```

Build artifacts are written to `dist-desktop/`.
