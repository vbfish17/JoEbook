<div align="center">
 <br />
 <img src="./assets/JoE_round.png" alt="JoEbook Logo" width="128" height="128" />
 <h1>🚀 JoEbook (久易)</h1>
 <p><b>Intelligent Form-Preserving Document Translation & Dual-Pane Proofreading Workspace</b></p>

 <p>
 A next-generation form-preserving document translation system powered by LLM context alignment, designed for academic PDFs, e-books, and business reports.
 </p>

 <p>
 <img src="https://img.shields.io/badge/Release-v1.3.0-blue?style=flat-square" alt="Version" />
 <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" alt="React 19" />
 <img src="https://img.shields.io/badge/TailwindCSS-v4.0-38bdf8?style=flat-square&logo=tailwindcss" alt="Tailwind CSS v4" />
 <img src="https://img.shields.io/badge/Electron-Desktop-47848F?style=flat-square&logo=electron" alt="Electron Native" />
 <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
 </p>

 <p>
 <b>
 <a href="./README_DEV.md">Developer Docs</a> · 
 <a href="#-changelog">Changelog</a> · 
 <a href="#-acknowledgements--open-source-heritage">Acknowledgements</a>
 </b>
 </p>
 <br />
</div>

---

> 📖 **[🇨🇳 点击阅读中文版说明 (Read Chinese Version)](./README_zh.md)**

## 💡 Why JoEbook? The Real Pain Point of Translation Formatting

In traditional document translation scenarios, we constantly face broken formatting, misaligned graphics, and text overflow:
* **Traditional Translation Software**: Destroys the original design. Centered titles break, charts misalign, margins collapse. The translated report loses its readability.
* **Screenshot Translation**: Maintains layout, but the text is uneditable, pixels are low resolution, and it's useless for academic research or high-quality publishing.

**JoEbook** is built to solve this. Designed for academic papers (PDFs), business reports, and e-books, it is a **next-generation form-preserving document translation system**. By extracting the document's structure and aligning contexts without altering the native layout, it replaces bilingual paragraphs flawlessly. Coupled with its **Dual-Pane Flow Proofreading Workspace**, it makes every translated workpiece look like a professionally typeset original.

---

## 🎨 Key Features & Highlights

### 1. 📂 Multi-Format Form-Preserving Extraction
* Supports major formats: **PDF, Word (.docx), Excel (.xlsx), EPUB, Markdown, JSON, etc.**
* Automatically skips style containers (e.g., table styling, floating charts, absolute positioning) and injects text precisely, preserving original line heights, font styles, and layouts.

### 2. 📑 Immersive Dual-Pane Proofreading Workspace (Babel Mode)
* Left pane: full-screen lossless rendering of the original document format. Right pane: synchronized sentence/paragraph editor supporting unlimited LLM tweaks.
* Linkage via DOM mapping points: clicking a translation on the right triggers a "breathing highlight" on the native layout on the left, instantly solving the "Where is this text in the chart?" pain point.

### 3. 🪄 Advanced AI Tone Tuning Matrix
* **Academic**: Optimized for high-level literature research and publication sentences.
* **Native**: Translates using native slang and industry jargon to eliminate rigid "machine translation" tone.
* **Concise**: Automatically rewrites content to fit strictly within specific layout constraints (like PPT text boxes), preventing text overflow issues.

### 4. 🗄️ High-Capacity Offline IndexedDB Engine
* Bypasses the restrictive 5MB quota of traditional LocalStorage. The built-in `idb-keyval` system loads and caches hundreds of megabytes of historical translation projects (even with tons of images) seamlessly without tab crashes.

### 5. 🚀 High-Volume Batch Smart Translation
* Queue up to 10 large analytical reports for batch automated translation. Supports file capacities up to 200MB each. Includes resilient state-recovery for networks.

### 6. 💻 Electron Desktop Application Output
* Comes with native cross-platform build kits for macOS/Windows, granting low-level compute advantages and rapid filesystem IO for native desktop deployment.

### 7. 📄 PDF High-Fidelity Overlay Translation
* Two-pass overlay strategy: first draws all white background rectangles, then inserts all translated text on top — ensuring translated text is never covered by overlapping rectangles from adjacent spans.
* Built-in CJK font support (`china-s`) eliminates the 23MB Arial Unicode MS font embedding problem, keeping translated PDFs compact (source 63KB → output ~9KB vs. previous 15MB).
* Auto-shrink font sizing when translated text exceeds the original bbox width, preventing text overflow into neighboring areas.

---

## 🛠️ Getting Started & Deployment

1. **Requirements**: Node.js v18.0.0+
2. **Clone repo**: `git clone https://github.com/vbfish17/JoEbook.git && cd JoEbook`
3. **Install dependencies**: `npm install`
4. **Start Development Server**: `npm run dev` (Access at `http://localhost:7050`)
5. **Production Build**: `npm run build` & `npm run start` (Bundled automatically for backend server deployment)
6. **Desktop Build (macOS)**: `npm run dist:mac` (Generates DMG in `dist-desktop/`)

---

## 📋 Changelog

### v1.3.0 (2026-05-28)
* **PDF High-Fidelity Translation**: Two-pass overlay strategy prevents translated text from being covered by overlapping white rectangles
* **PDF Size Fix**: Switched from embedding 23MB Arial Unicode MS to built-in `china-s` CJK font — translated PDFs now match source file size instead of ballooning to 15MB+
* **Translation State Reset**: Unified `resetTranslationState()` ensures all UI flags (progress, buttons, status) properly reset after translation completes or fails
* **Batch Processing Stability**: `handleBatchTranslate` now wraps in try/catch/finally to prevent `isBatchProcessing` from getting stuck in `true` state
* **Source Directory Detection**: Extracts `File.path` immediately on file input change for Electron IPC source directory sync
* **DMG Save Path Simplified**: Removed the non-functional save location setting UI; translated files now default to system Downloads directory

### v1.2.0 (2026-05-25)
* Initial public release with PDF/DOCX dual-engine translation
* Dual-Pane proofreading workspace (Babel Mode)
* Offline IndexedDB engine with unlimited capacity
* Batch smart translation (up to 10 files, 200MB each)
* Electron desktop application build support

---

## 💖 Acknowledgements & Open Source Heritage

The core parsing and rewriting logic in JoEbook is heavily inspired by and utilizes these brilliant open-source projects:
1. **[yihong0618/bilingual_book_maker](https://github.com/yihong0618/bilingual_book_maker)** - Guided our vision on non-destructive paragraph interpolation and large-scale structural markup handling, profoundly changing the way bilingual books are generated.
2. **[hopding/pdf-lib](https://github.com/hopding/pdf-lib)** - Extremely efficient library for document elements extraction and manipulation.
3. **[mozilla/pdf.js](https://github.com/mozilla/pdf.js)** - Provided the core inspiration for the physical mapping and synchronized DOM highlighting across our layout engine.
4. **[kovidgoyal/calibre](https://github.com/kovidgoyal/calibre)** - Our technical encyclopedia when interpreting format boundaries and handling edge-case document files.
5. **[jgm/pandoc](https://github.com/jgm/pandoc)** - Its beautiful philosophy on the Universal Abstract Syntax Tree (AST) inspired our adaptive multi-document streaming architecture.

---

## 🔒 License

* Under the **MIT License**. Free to use, adapt, and integrate into commercial systems.

---

*Feedback and suggestions are welcome.*
