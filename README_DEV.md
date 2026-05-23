# JoEbook Developer Guide

## Overview

JoEbook is a document translation workspace that combines a React frontend, an Express backend, and an Electron desktop shell. The current repository is focused on operating JoEbook as its own product identity.

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript bundled with esbuild
- Desktop shell: Electron + electron-builder
- Local persistence: IndexedDB through `idb-keyval`

## Local Development

Requirements:
- Node.js 18+
- npm

Install and run:

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm start
```

This produces browser assets in `dist/` and bundles the backend into `dist/server.cjs`.

## Environment Variables

Optional root `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
```

If this value is absent, users can still configure provider credentials inside the application UI.

## Desktop Packaging

Start Electron in development mode:

```bash
npm run electron:start
```

Build macOS DMG:

```bash
npm run dist:mac
```

Build Windows installer:

```bash
npm run dist:win
```

Artifacts are written to `dist-desktop/`.

## Release Guidance

Recommended release flow:

1. Run `npm install`
2. Run `npm run lint`
3. Run `npm run build`
4. Run `npm run dist:mac`
5. Create Git tag and GitHub Release
6. Upload generated DMG asset to the release

## Repository

- https://github.com/vbfish17/JoEbook
