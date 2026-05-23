<div align="center">
  <br />
  <h1>🚀 JoEbook (久易)</h1>
  <p><b>Intelligent Form-Preserving Document Translation & Dual-Pane Proofreading Workspace</b></p>

  <p>
    A next-generation form-preserving document translation system powered by LLM context alignment, designed for academic PDFs, e-books, and business reports.
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
      <a href="https://ais-pre-jtz4idduxc7va53lohaw7o-283544313319.us-west2.run.app">Live Demo</a> · 
      <a href="./README_DEV.md">Developer Docs</a> · 
      <a href="#-acknowledgements--open-source-heritage">Acknowledgements</a>
    </b>
  </p>
  <br />
</div>

---

> 📖 **[🇨🇳 点击阅读中文版说明 (Read Chinese Version)](./README_zh.md)**

## 💡 Why JoEbook? The Real Pain Point of Translation Formatting

In traditional document translation scenarios, we constantly face broken formatting, misaligned graphics, and text overflow:
*   **Traditional Translation Software**: Destroys the original design. Centered titles break, charts misalign, margins collapse. The translated report loses its readability.
*   **Screenshot Translation**: Maintains layout, but the text is uneditable, pixels are low resolution, and it's useless for academic research or high-quality publishing.

**JoEbook** is built to solve this. Designed for academic papers (PDFs), business reports, and e-books, it is a **next-generation form-preserving document translation system**. By extracting the document's structure and aligning contexts without altering the native layout, it replaces bilingual paragraphs flawlessly. Coupled with its **Dual-Pane Flow Proofreading Workspace**, it makes every translated workpiece look like a professionally typeset original.

---

## 🎨 Key Features & Highlights

### 1. 📂 Multi-Format Form-Preserving Extraction
*   Supports major formats: **PDF, Word (.docx), Excel (.xlsx), EPUB, Markdown, JSON, etc.**
*   Automatically skips style containers (e.g., table styling, floating charts, absolute positioning) and injects text precisely, preserving original line heights, font styles, and layouts.

### 2. 📑 Immersive Dual-Pane Proofreading Workspace (Babel Mode)
*   Left pane: full-screen lossless rendering of the original document format. Right pane: synchronized sentence/paragraph editor supporting unlimited LLM tweaks.
*   Linkage via DOM mapping points: clicking a translation on the right triggers a "breathing highlight" on the native layout on the left, instantly solving the "Where is this text in the chart?" pain point.

### 3. 🪄 Advanced AI Tone Tuning Matrix
*   **Academic**: Optmized for high-level literature research and publication sentences.
*   **Native**: Translates using native slang and industry jargon to eliminate rigid "machine translation" tone.
*   **Concise**: Automatically rewrites content to fit strictly within specific layout constrains (like PPT text boxes), preventing text overflow issues.

### 4. 🗄️ High-Capacity Offline IndexedDB Engine
*   Bypasses the restrictive 5MB quota of traditional LocalStorage. The built-in `idb-keyval` system loads and caches hundreds of megabytes of historical translation projects (even with tons of images) seamlessly without tab crashes.

### 5. 🚀 High-Volume Batch Smart Translation
*   Queue up to 10 large analytical reports for batch automated translation. Supports file capacities up to 200MB each. Includes resilient state-recovery for networks.

### 6. 💻 Electron Desktop Application Output
*   Comes with native cross-platform build kits for macOS/Windows, granting low-level compute advantages and rapid filesystem IO for native desktop deployment.

---

## 🛠️ Getting Started & Deployment

1. **Requirements**: Node.js v18.0.0+
2. **Clone repo**: `git clone https://github.com/vbfish17/JoEbook.git && cd JoEbook`
3. **Install dependencies**: `npm install`
4. **Start Development Server**: `npm run dev` (Access at `http://localhost:7050`)
5. **Production Build**: `npm run build` & `npm run start` (Bundled automatically for backend server deployment)

---

## 💖 Acknowledgements & Open Source Heritage

The core parsing and rewriting logic in JoEbook is heavily inspired by and utilizes these brilliant open-source projects:
1. **[yihong0618/bilingual_book_maker](https://github.com/yihong0618/bilingual_book_maker)** - Guided our vision on non-destructive paragraph interpolation and large-scale structural markup handling, profoundly changing the way bilingual books are generated.
2. **[hopding/pdf-lib](https://github.com/hopding/pdf-lib)** - Extremely efficient library for document elements extraction and manipulation.
3. **[mozilla/pdf.js](https://github.com/mozilla/pdf.js)** - Provided the core inspiration for the physical mapping and synchronized DOM highlighting across our layout engine.
4. **[kovidgoyal/calibre](https://github.com/kovidgoyal/calibre)** - Our technical encyclopedia when interpreting format boundaries and handling edge-case document files.
5. **[jgm/pandoc](https://github.com/jgm/pandoc)** - Its beautiful philosophy on the Universal Abstract Syntax Tree (AST) inspired our adaptive multi-document streaming architecture.

---

## 🔒 Open Source License & Roadmap

*   Under the **MIT License**. Free to use, adapt, and integrate into commercial systems.
*   **Roadmap**:
    1. [x] Form-preserving PDF/DOCX dual-lingual export and layout mapping validation.
    2. [x] Local environment fallback via `idb-keyval` for limitless offline projects management.
    3. [ ] Integrations for offline OCR extraction & layout partitioning for scanned PDFs.
    4. [ ] Edge device computational adaptations for vector-based EPUB/PDF reconstructions.

---

*Feedback and suggestions are welcome.*
