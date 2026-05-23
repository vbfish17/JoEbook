# JoEbook

JoEbook 是一个面向长文档场景的保留版式翻译工作台，重点服务于 PDF、DOCX、PPTX、EPUB、Markdown 等阅读型与交付型文档。目标是在可控的工作流中完成翻译、校对与导出，而不是作为通用 AI 演示项目存在。

## 产品定位

当前代码库主要围绕以下能力构建：

1. 多格式文档导入
2. 可配置的大模型翻译能力
3. 双语校对与编辑流程
4. 面向桌面交付的打包发布能力

## 核心能力

- 导入 PDF、DOCX、PPTX、EPUB、Markdown、JSON 等文件
- 通过 Gemini 或兼容 OpenAI 的接口接入翻译模型
- 本地缓存翻译记录，便于回看与继续处理
- 在双栏工作区中进行双语校对与编辑
- 通过 Electron 打包为桌面应用

## 本地开发

环境要求：
- Node.js 18+
- npm

启动命令：

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:3000`。

## 生产构建

```bash
npm run build
npm start
```

## 桌面打包

构建 macOS DMG：

```bash
npm run dist:mac
```

构建 Windows 安装包：

```bash
npm run dist:win
```

桌面产物输出目录为 `dist-desktop/`。

## 环境变量

如需配置共享 Gemini Key，可在项目根目录创建 `.env`：

```env
GEMINI_API_KEY=your_gemini_api_key
```

若不配置共享密钥，用户仍可在应用内填写自己的模型接口信息。

## 仓库地址

- GitHub: https://github.com/vbfish17/JoEbook

## License

MIT
