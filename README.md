# JoEbook

JoEbook is a structure-preserving document translation workspace focused on long-form reading materials such as PDFs, DOCX files, PPTX decks, EPUB books, and Markdown manuscripts. It helps users translate content while keeping layout, file structure, and bilingual review flow manageable.

## Positioning

JoEbook is intended to be a practical translation workstation rather than a generic AI demo. The current codebase focuses on:

1. Multi-format document import
2. LLM-powered translation with configurable providers
3. Bilingual review and editing workflow
4. Export-oriented desktop packaging for macOS and Windows

## Core Capabilities

- Import document formats including PDF, DOCX, PPTX, EPUB, Markdown, and JSON
- Configure translation providers through OpenAI-compatible endpoints or Gemini
- Cache translation history locally for repeated review
- Review bilingual content inside a dual-pane workspace
- Package the app as a desktop application with Electron

## Local Development

Requirements:
- Node.js 18+
- npm

Commands:

```bash
npm install
npm run dev
```

The development server runs on `http://localhost:3000`.

## Production Build

```bash
npm run build
npm start
```

## Desktop Packaging

Build macOS DMG:

```bash
npm run dist:mac
```

Build Windows installer:

```bash
npm run dist:win
```

Generated desktop artifacts are written to `dist-desktop/`.

## Environment Variables

Create a `.env` file in the project root when needed:

```env
GEMINI_API_KEY=your_gemini_api_key
```

If no shared key is configured, users can still provide their own provider credentials inside the app.

## Repository

- GitHub: https://github.com/vbfish17/JoEbook

## License

MIT
