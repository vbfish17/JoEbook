import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import JSZip from 'jszip';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit/dist/fontkit.umd.js';
import { PDFParse } from 'pdf-parse';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Resolve the app root directory: in Electron DMG, __dirname is the dist/ folder;
// in dev mode (tsx), process.cwd() is the project root.
function getAppRoot(): string {
  // Check if we're running in the compiled dist/ directory (Electron production)
  if (typeof __dirname !== 'undefined' && __dirname.includes('/dist')) {
    return path.resolve(__dirname, '..');
  }
  // In development (tsx), use cwd
  return process.cwd();
}

const APP_ROOT = getAppRoot();

// Auto-detect available Python interpreter — try multiple common locations
function findPython(): string {
  const candidates = [
    '/Users/lian/miniforge3/bin/python3',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',
    '/usr/bin/python3',
    'python3',
    'python'
  ];
  for (const py of candidates) {
    try {
      execSync(`${py} --version`, { stdio: 'pipe', timeout: 3000 });
      return py;
    } catch { continue; }
  }
  return 'python3'; // fallback, will fail gracefully later
}
const PDF2ZH_PYTHON = findPython();

function scriptExists(name: string): boolean {
  try {
    const p = path.resolve(APP_ROOT, name);
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch { return false; }
}

// In Electron DMG, scripts are in asar.unpacked (not inside the asar archive).
// Python child processes cannot read from asar archives — they need real filesystem paths.
// This function converts an asar-internal path to the real .asar.unpacked/ path.
function realScriptPath(name: string): string {
  const p = path.resolve(APP_ROOT, name);
  // Electron fs patch handles asar → unpacked mapping for Node.js fs,
  // but Python subprocesses need the real .asar.unpacked/ path.
  if (p.includes('.asar/')) {
    const unpacked = p.replace('.asar/', '.asar.unpacked/');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return p;
}

// Get real filesystem path for cwd in Python subprocesses (can't be inside asar)
function realAppRoot(): string {
  if (APP_ROOT.includes('.asar/')) {
    const unpacked = APP_ROOT.replace('.asar/', '.asar.unpacked/');
    if (fs.existsSync(unpacked)) return unpacked;
  } else if (APP_ROOT.includes('.asar')) {
    // Edge case: APP_ROOT ends with .asar (the archive itself)
    const unpacked = APP_ROOT.replace('.asar', '.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return APP_ROOT;
}
const APP_ROOT_REAL = realAppRoot();

const PDF2ZH_SCRIPT = realScriptPath('scripts/pdf_translate_via_pdf2zh.py');

type CustomApiConfig = { apiKey?: string; baseUrl?: string; model?: string };
type AgentRole = 'planner' | 'executor' | 'proofreader';
type AgentBatchPlan = {
  id?: string;
  role?: AgentRole;
  workerIndex?: number;
  startIndex?: number;
  endIndex?: number;
  itemCount?: number;
};
type AgentPlanPayload = {
  enabled?: boolean;
  totalItems?: number;
  batchSize?: number;
  executorBatches?: AgentBatchPlan[];
  roles?: Record<AgentRole, { count?: number; api?: CustomApiConfig }>;
  modelProfiles?: Record<AgentRole, CustomApiConfig | null>;
  summary?: string;
};

function parseJsonField<T>(value: any): T | undefined {
  if (!value) return undefined;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
}

function apiForRole(plan: AgentPlanPayload | undefined, role: AgentRole, fallback?: CustomApiConfig): CustomApiConfig | undefined {
  // Priority 1: modelProfiles (sent from frontend with full API config per role)
  const mp = plan?.modelProfiles?.[role];
  if (mp && (mp.baseUrl || mp.apiKey || mp.model)) {
    return {
      apiKey: mp.apiKey || fallback?.apiKey,
      baseUrl: mp.baseUrl || fallback?.baseUrl,
      model: mp.model || fallback?.model,
    };
  }
  // Priority 2: roles[].api (from planAgentAllocation)
  const roleApi = plan?.roles?.[role]?.api;
  if (roleApi && (roleApi.baseUrl || roleApi.apiKey || roleApi.model)) {
    return {
      apiKey: roleApi.apiKey || fallback?.apiKey,
      baseUrl: roleApi.baseUrl || fallback?.baseUrl,
      model: roleApi.model || fallback?.model,
    };
  }
  // Priority 3: fallback (current custom API)
  return fallback;
}

function isAgentPlanEnabled(plan: AgentPlanPayload | undefined): boolean {
  return !!(plan?.enabled && Array.isArray(plan.executorBatches) && plan.executorBatches.length > 0);
}

function estimateExecutorCount(plan: AgentPlanPayload | undefined): number {
  if (!isAgentPlanEnabled(plan)) return 0;
  const fromBatches = plan?.executorBatches?.length || 0;
  const fromRole = plan?.roles?.executor?.count || 0;
  return Math.max(1, Math.min(12, Math.floor(Math.max(fromBatches, fromRole))));
}

function estimateAgentBatchSize(plan: AgentPlanPayload | undefined, fallback: number): number {
  if (!isAgentPlanEnabled(plan)) return fallback;
  const declared = Math.floor(Number(plan?.batchSize) || 0);
  if (declared > 0) return Math.max(1, Math.min(80, declared));
  const total = Math.floor(Number(plan?.totalItems) || 0);
  const executors = estimateExecutorCount(plan);
  if (total > 0 && executors > 0) return Math.max(1, Math.ceil(total / executors));
  return fallback;
}


function applyTerminologyMemory(text: string, glossaryTerms?: { source: string; target: string }[]): string {
  if (!glossaryTerms || glossaryTerms.length === 0) return text;
  let output = String(text || '');
  const sorted = [...glossaryTerms]
    .filter(t => t?.source && t?.target)
    .sort((a, b) => b.source.length - a.source.length);
  for (const term of sorted) {
    // Case-insensitive replacement: split on source (case-insensitively) and join with target
    const escaped = term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    output = output.replace(regex, term.target);
  }
  return output;
}

function applyTerminologyMemoryBatch(texts: string[], glossaryTerms?: { source: string; target: string }[]): string[] {
  return texts.map(text => applyTerminologyMemory(text, glossaryTerms));
}

function normalizePdf2zhLang(value: string | undefined): string {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'auto') return 'en';
  if (text === 'english' || text === 'en') return 'en';
  if (text === 'chinese' || text === 'chinese (simplified)' || text === 'chinese (traditional)' || text === 'zh') return 'zh';
  if (text === 'japanese' || text === 'ja') return 'ja';
  if (text === 'korean' || text === 'ko') return 'ko';
  return text || 'en';
}

function canUsePdf2zh(customApi?: CustomApiConfig): boolean {
  return !!(customApi?.baseUrl && customApi?.model);
}

async function translatePdfViaPdf2zh(
  fileBuffer: Buffer,
  progress: (msg: string) => void,
  customApi: CustomApiConfig,
  sourceLang: string | undefined,
  targetLang: string
): Promise<{ docxBuffer: Buffer; pdfBuffer: Buffer; textContent: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'joebook-pdf2zh-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  const outputPdfPath = path.join(tempDir, 'translated.pdf');
  const outputDualPdfPath = path.join(tempDir, 'translated-dual.pdf');
  const outputTextPath = path.join(tempDir, 'translated.txt');
  const jsonOutPath = path.join(tempDir, 'result.json');

  try {
    await fs.promises.writeFile(inputPath, fileBuffer);
    progress('已切换到 PDFMathTranslate 高保真 PDF 引擎...');

    const args = [
      PDF2ZH_SCRIPT,
      '--input', inputPath,
      '--lang-in', normalizePdf2zhLang(sourceLang),
      '--lang-out', normalizePdf2zhLang(targetLang),
      '--base-url', String(customApi.baseUrl || '').trim(),
      '--model', String(customApi.model || '').trim(),
      '--api-key', customApi.apiKey || 'not-required',
      '--output-pdf', outputPdfPath,
      '--output-dual-pdf', outputDualPdfPath,
      '--output-text', outputTextPath,
      '--json-out', jsonOutPath,
    ];

    const { stdout, stderr } = await execFileAsync(PDF2ZH_PYTHON, args, {
      cwd: APP_ROOT_REAL,
      maxBuffer: 20 * 1024 * 1024,
    });

    if (stderr?.trim()) {
      console.warn('[pdf2zh stderr]', stderr.trim());
    }
    if (stdout?.trim()) {
      console.log('[pdf2zh stdout]', stdout.trim());
    }

    const [pdfBuffer, textContent, jsonText] = await Promise.all([
      fs.promises.readFile(outputPdfPath),
      fs.promises.readFile(outputTextPath, 'utf8'),
      fs.promises.readFile(jsonOutPath, 'utf8'),
    ]);

    const meta = JSON.parse(jsonText);
    console.log('[pdf2zh result]', meta);
    progress(`PDFMathTranslate 输出完成：${meta.pdf_size || pdfBuffer.length} bytes，文本 ${meta.text_chars || textContent.length} 字符。`);

    return {
      docxBuffer: Buffer.from(textContent, 'utf8'),
      pdfBuffer,
      textContent,
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

const PYMUPDF_SCRIPT = realScriptPath('scripts/pdf_translate_via_pymupdf.py');

function canUsePymupdf(customApi?: CustomApiConfig): boolean {
  return !!(customApi?.baseUrl && customApi?.model);
}

async function translatePdfViaPymupdf(
  fileBuffer: Buffer,
  progress: (msg: string) => void,
  customApi: CustomApiConfig,
  sourceLang: string | undefined,
  targetLang: string
): Promise<{ docxBuffer: Buffer; pdfBuffer: Buffer; textContent: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'joebook-pymupdf-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  const outputPath = path.join(tempDir, 'translated.pdf');
  const outputTextPath = path.join(tempDir, 'translated.txt');

  try {
    await fs.promises.writeFile(inputPath, fileBuffer);
    progress('已切换到 PyMuPDF 高保真 PDF 翻译引擎（保留原版式与颜色）...');

    const args = [
      PYMUPDF_SCRIPT,
      '--input', inputPath,
      '--lang-in', normalizePdf2zhLang(sourceLang),
      '--lang-out', normalizePdf2zhLang(targetLang),
      '--base-url', String(customApi.baseUrl || '').trim(),
      '--model', String(customApi.model || '').trim(),
      '--api-key', customApi.apiKey || 'not-required',
      '--output-pdf', outputPath,
      '--output-text', outputTextPath,
    ];

    const { stdout, stderr } = await execFileAsync(PDF2ZH_PYTHON, args, {
      cwd: APP_ROOT_REAL,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr?.trim()) {
      console.warn('[pymupdf stderr]', stderr.trim());
    }
    if (stdout?.trim()) {
      console.log('[pymupdf stdout]', stdout.trim());
    }

    const [pdfBuffer, textContent] = await Promise.all([
      fs.promises.readFile(outputPath),
      fs.promises.readFile(outputTextPath, 'utf8'),
    ]);

    progress(`PyMuPDF 输出完成：${pdfBuffer.length} bytes，文本 ${textContent.length} 字符。`);
    return {
      docxBuffer: Buffer.from(textContent, 'utf8'),
      pdfBuffer,
      textContent,
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function pdfParse(fileBuffer: Buffer): Promise<{ text: string }> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
    const result = await parser.getText();
    const reassembledText = result.pages.map(p => p.text).join('\f');
    return {
      text: reassembledText
    };
  } catch (err: any) {
    console.error('Error invoking PDFParse class:', err);
    throw new Error(`PDF 解析失败: ${err.message || err}`);
  }
}
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const pdfFontCache: Record<string, Buffer> = {};
const pdfFontCandidates = {
  cjk: [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
  ],
  zh: [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
  ],
  ja: [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
  ],
  ko: [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
  ]
} as const;

async function fetchFontWithTimeout(url: string, timeoutMs = 2500): Promise<Buffer> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function resolvePdfFontCandidates(targetLang: string): string[] {
  const lang = String(targetLang || '').toLowerCase();
  if (lang.includes('zh') || lang.includes('cn') || lang.includes('chinese')) return [...pdfFontCandidates.zh];
  if (lang.includes('ja') || lang.includes('jp') || lang.includes('japanese')) return [...pdfFontCandidates.ja];
  if (lang.includes('ko') || lang.includes('korean')) return [...pdfFontCandidates.ko];
  if (/[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(targetLang)) return [...pdfFontCandidates.cjk];
  return [];
}

async function loadLocalPdfFontBuffer(targetLang: string): Promise<Buffer | null> {
  const candidates = resolvePdfFontCandidates(targetLang);
  console.log('[PDF font] candidate paths', { targetLang, candidates });
  for (const fontPath of candidates) {
    try {
      if (!pdfFontCache[fontPath]) {
        const buffer = await fs.promises.readFile(fontPath);
        pdfFontCache[fontPath] = buffer;
        console.log('[PDF font] read success', { fontPath, size: buffer.length });
      }
      return pdfFontCache[fontPath];
    } catch (err: any) {
      console.warn('[PDF font] read failed', { fontPath, message: err?.message || String(err) });
      continue;
    }
  }
  return null;
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text);
}

function tokenizeForHybridWrap(text: string): string[] {
  return text.match(/[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]|[^\s\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]+|\s+/g) || [];
}

function safeMeasureText(font: any, text: string, fontSize: number): number {
  try {
    return font.widthOfTextAtSize(text, fontSize);
  } catch {
    if (containsCjk(text)) return text.length * fontSize * 0.92;
    return text.length * fontSize * 0.52;
  }
}

function wrapHybridText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const paragraphs = text.split(/\n+/);
  const wrapped: string[] = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      wrapped.push('');
      continue;
    }

    const tokens = tokenizeForHybridWrap(trimmed);
    let currentLine = '';

    for (const token of tokens) {
      const candidate = currentLine ? `${currentLine}${token}` : token;
      const candidateWidth = safeMeasureText(font, candidate, fontSize);

      if (candidateWidth <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine.trim()) {
        wrapped.push(currentLine.trimEnd());
      }

      const tokenWidth = safeMeasureText(font, token, fontSize);
      if (tokenWidth <= maxWidth) {
        currentLine = token.trimStart();
        continue;
      }

      let chunk = '';
      for (const ch of token) {
        const nextChunk = `${chunk}${ch}`;
        if (safeMeasureText(font, nextChunk, fontSize) > maxWidth && chunk) {
          wrapped.push(chunk);
          chunk = ch;
        } else {
          chunk = nextChunk;
        }
      }
      currentLine = chunk;
    }

    if (currentLine.trim()) {
      wrapped.push(currentLine.trimEnd());
    }
  }

  return wrapped;
}

function addPdfPage(pdfDoc: PDFDocument, pageNumber: number, font: any, fallbackFont?: any) {
  const page = pdfDoc.addPage([595.276, 841.89]);
  const { height } = page.getSize();
  const headerText = `JoEbook Translation Output · Page ${pageNumber}`;
  try {
    page.drawText(headerText, {
      x: 50,
      y: height - 32,
      size: 8,
      font,
      color: rgb(0.45, 0.45, 0.45)
    });
  } catch {
    page.drawText(headerText.replace(/[^\x00-\x7F]/g, '?'), {
      x: 50,
      y: height - 32,
      size: 8,
      font: fallbackFont || font,
      color: rgb(0.45, 0.45, 0.45)
    });
  }
  return page;
}

function drawWrappedBlock(
  pdfDoc: PDFDocument,
  page: any,
  lines: string[],
  state: { y: number; pageNumber: number },
  font: any,
  fontSize: number,
  lineHeight: number,
  topY: number,
  bottomMargin: number,
  fallbackFont?: any
) {
  let currentPage = page;
  for (const line of lines) {
    if (state.y < bottomMargin) {
      state.pageNumber += 1;
      currentPage = addPdfPage(pdfDoc, state.pageNumber, font);
      state.y = topY;
    }
    try {
      currentPage.drawText(line || ' ', {
        x: 50,
        y: state.y,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1)
      });
    } catch (err) {
      if (!fallbackFont) throw err;
      const sanitized = (line || ' ').replace(/[^\x00-\x7F]/g, '?');
      currentPage.drawText(sanitized || ' ', {
        x: 50,
        y: state.y,
        size: fontSize,
        font: fallbackFont,
        color: rgb(0.1, 0.1, 0.1)
      });
    }
    state.y -= lineHeight;
  }
  return currentPage;
}

const app = express();
const DEFAULT_PORT = 7050;
const PORT = Number(process.env.JOEBOOK_PORT || DEFAULT_PORT);
// JoEbook server entry for local development and packaged desktop runtime.

// Enable JSON and URL-encoded body parsing
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// Configure Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 210 * 1024 * 1024 } // 210MB limit per file
});

// Helper: Escape string for insertion in XML
function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  retries = 6,
  delayMs = 1500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const errMsg = error.message || String(error);
      const isRateLimit = errMsg.includes('429') || 
                          errMsg.toLowerCase().includes('resource_exhausted') || 
                          errMsg.toLowerCase().includes('quota') || 
                          errMsg.toLowerCase().includes('limit') ||
                          error.status === 429;
      
      if (isRateLimit && attempt <= retries) {
        // Default exponential backoff with some jitter
        let backoff = delayMs * Math.pow(2.2, attempt - 1) + Math.random() * 1000;
        
        // Advanced: Parse strict rate-limit delay if explicitly specified in Gemini's 429 payload
        const retryInMatch = errMsg.match(/Please retry in ([\d.]+)\s*s/i);
        const retryDelayMatch = errMsg.match(/retryDelay"?\s*:\s*"?(\d+)/i);
        
        if (retryInMatch && retryInMatch[1]) {
          const secs = parseFloat(retryInMatch[1]);
          if (!isNaN(secs) && secs > 0) {
            backoff = (secs + 1.2) * 1000;
            console.warn(`[限频控制] 遇到 429，检测到 API 要求等待 ${secs}s。动态定序延迟睡眠 ${Math.round(backoff)}ms...`);
          }
        } else if (retryDelayMatch && retryDelayMatch[1]) {
          const secs = parseInt(retryDelayMatch[1], 10);
          if (!isNaN(secs) && secs > 0) {
            backoff = (secs + 1.2) * 1000;
            console.warn(`[限频控制] 遇到 429，检测到 retryDelay 为 ${secs}s。动态定序延迟睡眠 ${Math.round(backoff)}ms...`);
          }
        }
        
        console.warn(`[限频/配额警告] 遇到 429 (RESOURCE_EXHAUSTED / Rate Limit)。将在 ${Math.round(backoff)}ms 后重试（当前为第 ${attempt}/${retries} 次重试）...`);
        await delay(backoff);
        continue;
      }
      
      if (isRateLimit) {
        const isUsingCustom = !!(customApi && customApi.apiKey && customApi.apiKey !== 'not-required');
        let friendlyMsg = "";
        if (isUsingCustom) {
          friendlyMsg = `【您的 API 密钥触发了频频控制或额度上限 / Rate Limit Error (429)】
检测到您填入的自定义翻译密钥 (Custom Key) / API 请求节点返回了 429 超期、频频限流或额度超额异常。

🔧【自助排查方案】：
1. 检查您的 API Key 账户是否已经欠费或过期。
2. 多数免费 API 密钥 (例如 Google Gemini 免费级别通道) 官方限频通常设定在极低的每分钟 15 次内。如果您正在翻译具有大量幻灯片或段落的长文件，请稍等一分钟阻碍后再发起重试，或者考虑切换更优质的 Pro 付费 API 密钥。`;
        } else {
          friendlyMsg = `【内置共享测试额度已限制或已用尽 / Quota Limit (429)】
由于当前大量测试用户同时在线体验智能翻译，内置公共免费测试接口已触发了 Google 官方每分钟请求频率(RPM)上限或日累计额度限制。

🛠【自主添加密钥，100% 极速排版完全翻译】：
1. 请点击页面右上角或控制面板的【设置 (⚙ Settings)】。
2. 开启【启用第三方自建接口】。
3. 推荐在模型预设中选中【Gemini (Google Official)】。
4. 在 API Key 输入框中填入您自己专属的 Google Gemini API 密钥 (Free 或 Pro 的 Key 均可，可在 https://ai.google.dev 秒级免费申请专属 Key)。
5. 重新提交翻译文件，即可彻底解除任何共享速率限制，体验 100% 完美流卷体验！`;
        }
        throw new Error(friendlyMsg);
      }
      
      throw error;
    }
  }
}

export async function translateTextBatch(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  tone: string,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  isRecursive = false,
  glossaryTerms?: { source: string; target: string }[]
): Promise<string[]> {
  const sourceText = sourceLang === 'Auto' ? 'auto-detected language' : sourceLang;
  const normalizedModel = (customApi?.model || '').toLowerCase();
  const normalizedBaseUrl = (customApi?.baseUrl || '').toLowerCase();
  const isLmStudio = normalizedBaseUrl.includes('localhost:1234') || normalizedBaseUrl.includes('127.0.0.1:1234') || normalizedBaseUrl.includes('lmstudio');
  const isTranslateGemma = normalizedModel.includes('translategemma');
  const useTranslateGemmaMode = isLmStudio && isTranslateGemma;

  const systemInstruction = useTranslateGemmaMode
    ? ''
    : `You are a professional bilingually-fluent document translator. 
Your primary task is to translate an array of text segments from "${sourceText}" to "${targetLang}".
Always maintain a "${tone}" tone, natural expression, correct style, and exact formatting placeholders.

CRITICAL RULES:
1. You MUST return translations inside a valid JSON object matching the requested schema.
2. The number of translation strings in the returned "translations" array MUST be exactly identical to the input list (${texts.length} items).
3. Keep all technical terms, markup tags, HTML sub-elements, inline style tokens, variables, or braces (e.g. {1}) exactly as they are. Translate only the surrounding natural text.
4. If a block consists entirely of numbers, code syntax, empty spaces, or placeholder characters, return it unchanged.
5. Return ONLY the JSON response - do not decorate it with markdown codeblocks or other chat text.`;

  // ── 术语记忆注入：如果有术语表，追加到 systemInstruction ──
  let finalSystemInstruction = systemInstruction;
  if (glossaryTerms && glossaryTerms.length > 0) {
    const glossaryLines = glossaryTerms.map(t => `   ${t.source} → ${t.target}`).join('\n');
    const glossaryBlock = `6. TERMINOLOGY MAPPING (MANDATORY): When translating, you MUST use the following term mappings exactly. If a source term appears in the text, translate it to the specified target term without exception:\n${glossaryLines}`;
    finalSystemInstruction = systemInstruction + '\n\n' + glossaryBlock;
  }

  const buildTranslateGemmaPrompt = (text: string) => `<<<source>>>${sourceText}<<<target>>>${targetLang}<<<text>>>${text}`;

  const parseTranslateGemmaBatch = (content: string): string[] => {
    const cleaned = content.trim().replace(/^```[a-zA-Z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    const segments = cleaned
      .split(/\n\s*<<<end>>>\s*\n|\n\s*---\s*\n|\n{2,}/)
      .map(s => s.trim())
      .filter(Boolean);
    if (segments.length === texts.length) return segments;
    return [cleaned];
  };

  // Detect if we should use official Google GenAI SDK for custom API integrations (rather than general OpenAI completions middleware)
  let useOfficialGoogleSdkForCustomKey = false;
  if (customApi && customApi.apiKey && customApi.apiKey !== 'not-required') {
    const bUrl = customApi.baseUrl || '';
    const mdl = customApi.model || '';
    if (!bUrl || bUrl.includes('googleapis.com') || bUrl.includes('google')) {
      if (mdl.includes('gemini-')) {
        useOfficialGoogleSdkForCustomKey = true;
      }
    }
  }

  let results: string[] = [];
  try {
    if (useOfficialGoogleSdkForCustomKey) {
      const keyToUse = customApi?.apiKey;
      const modelToUse = customApi?.model || 'gemini-2.5-flash';
      
      results = await retryWithBackoff(async () => {
        const ai = new GoogleGenAI({
          apiKey: keyToUse!,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const prompt = `Translate the following text segments. Input array: ${JSON.stringify(texts)}`;
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: prompt,
          config: {
            systemInstruction: finalSystemInstruction,
            temperature: 0.3,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                translations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.STRING
                  }
                }
              },
              required: ["translations"]
            }
          }
        });

        if (!response.text) return texts;
        const cleanJson = response.text.trim();
        const data = JSON.parse(cleanJson);
        return data.translations || [];
      }, customApi);
    } 
    
    // Custom OpenAI-compatible API configurations (DeepSeek, OpenAI, Qwen, Ollama, etc.)
    else if (customApi && customApi.apiKey && customApi.baseUrl) {
      let rawUrl = customApi.baseUrl.trim();
      if (rawUrl.endsWith('/')) {
        rawUrl = rawUrl.slice(0, -1);
      }
      if (rawUrl.endsWith('/chat/completions')) {
        rawUrl = rawUrl.slice(0, -17);
      } else if (rawUrl.endsWith('/chat')) {
        rawUrl = rawUrl.slice(0, -5);
      }
      const baseUrl = rawUrl;
      const model = customApi.model || 'gpt-3.5-turbo';
      
      results = await retryWithBackoff(async () => {
        if (useTranslateGemmaMode) {
          console.log('[TranslateGemma] mode ON', { model, baseUrl, count: texts.length, sourceText, targetLang });
          const translatedResults: string[] = [];

          // ── 术语记忆提示（TranslateGemma 模式） ──
          let glossaryHint = '';
          if (glossaryTerms && glossaryTerms.length > 0) {
            const mappings = glossaryTerms.map(t => `${t.source} → ${t.target}`).join(', ');
            glossaryHint = ` [TERMINOLOGY: You MUST use these term mappings: ${mappings}]`;
          }

          for (const text of texts) {
            const promptText = `Translate strictly and return only the final translation with no explanation.${glossaryHint} ${buildTranslateGemmaPrompt(text)}`;
            const bodyObj = {
              model,
              messages: [
                {
                  role: 'user',
                  content: promptText
                }
              ],
              temperature: 0,
              max_tokens: 512
            };

            console.log('[TranslateGemma] request text', text);
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${customApi?.apiKey}`
              },
              body: JSON.stringify(bodyObj)
            });

            if (!response.ok) {
              throw new Error(`TranslateGemma API returned status ${response.status}: ${await response.text()}`);
            }

            const result = await response.json();
            const content = result.choices?.[0]?.message?.content || result.choices?.[0]?.text || '';
            console.log('[TranslateGemma] raw content', content);
            if (!content) {
              translatedResults.push(text);
              continue;
            }
            const parsed = parseTranslateGemmaBatch(content);
            const finalText = (parsed[0] || content).trim();
            console.log('[TranslateGemma] final text', finalText);
            translatedResults.push(applyTerminologyMemory(finalText, glossaryTerms));
          }
          console.log('[TranslateGemma] translatedResults', translatedResults);
          return translatedResults;
        }

        const prompt = `Translate the following text items. \nInput items list (JSON formatted):\n${JSON.stringify({ paragraphs: texts }, null, 2)}\n\nReturn a JSON with the key "translations" containing the array of translations in the exact same sequence. No explanations and no Markdown blocks.`;

 const makeRequest = async (includeJsonFormat: boolean) => {
 const bodyObj: any = {
 model: model,
 messages: [
 { role: 'system', content: finalSystemInstruction },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3
          };
          if (includeJsonFormat) {
            bodyObj.response_format = { type: "json_object" };
          }
          return await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${customApi?.apiKey}`
            },
            body: JSON.stringify(bodyObj)
          });
        };

        let response = await makeRequest(true);
        
        if (!response.ok && (response.status === 400 || response.status === 422)) {
          console.warn("Attempting custom API call fallback without response_format json_object...");
          response = await makeRequest(false);
        }

        if (!response.ok) {
          throw new Error(`Custom LLM API returned status ${response.status}: ${await response.text()}`);
        }
        
        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || result.choices?.[0]?.text || result.content || (typeof result === 'string' ? result : undefined);
        if (!content) {
          throw new Error('Received empty content response from custom LLM.');
        }

        const parseFlexibleJson = (str: string): any => {
          let clean = str.trim();
          clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
          try {
            return JSON.parse(clean);
          } catch {
            const startCurly = clean.indexOf('{');
            const startSquare = clean.indexOf('[');
            
            let startIdx = -1;
            let endChar = '';
            
            if (startCurly !== -1 && (startSquare === -1 || startCurly < startSquare)) {
              startIdx = startCurly;
              endChar = '}';
            } else if (startSquare !== -1) {
              startIdx = startSquare;
              endChar = ']';
            }
            
            if (startIdx !== -1) {
              const endIdx = clean.lastIndexOf(endChar);
              if (endIdx !== -1 && endIdx > startIdx) {
                try {
                  return JSON.parse(clean.substring(startIdx, endIdx + 1));
                } catch (recurseErr: any) {
                  throw new Error(`Invalid JSON inside candidate block: ${recurseErr.message}. Raw text was: ${str}`);
                }
              }
            }
            throw new Error(`Failed to locate JSON container ({...} or [...]) in model output. Raw text was: ${str}`);
          }
        };

        const data = parseFlexibleJson(content);
        if (Array.isArray(data)) {
          return applyTerminologyMemoryBatch(data.map(v => String(v)), glossaryTerms);
        }
        if (data && typeof data === 'object') {
          if (Array.isArray(data.translations)) return applyTerminologyMemoryBatch(data.translations.map((v: any) => String(v)), glossaryTerms);
          if (Array.isArray(data.translated)) return applyTerminologyMemoryBatch(data.translated.map((v: any) => String(v)), glossaryTerms);
          if (Array.isArray(data.paragraphs)) return applyTerminologyMemoryBatch(data.paragraphs.map((v: any) => String(v)), glossaryTerms);
          if (Array.isArray(data.results)) return applyTerminologyMemoryBatch(data.results.map((v: any) => String(v)), glossaryTerms);
          const foundArray = Object.values(data).find(v => Array.isArray(v)) as any[] | undefined;
          if (foundArray) return applyTerminologyMemoryBatch(foundArray.map((v: any) => String(v)), glossaryTerms);
        }
        return applyTerminologyMemoryBatch(texts, glossaryTerms);
      }, customApi);
 } else {
 // Gemini default API removed — custom API configuration is required
 throw new Error("请先配置翻译模型接口。点击右上角【设置 (⚙ Settings)】，开启【启用第三方自建接口】，选择模型预设（如 DeepSeek / OpenAI / Ollama / LM Studio 等）并填入 API 地址与密钥，即可开始翻译。");
 }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isFatal = 
      errMsg.includes('内置公用') ||
      errMsg.includes('403') || 
      errMsg.includes('PERMISSION_DENIED') || 
      errMsg.includes('401') || 
      errMsg.includes('UNAUTHORIZED') || 
      errMsg.includes('API_KEY_INVALID') ||
      errMsg.includes('apiKey') ||
      errMsg.includes('API key');

    if (isFatal) {
      console.error(`[致命翻译异常] 检测到配置或权限异常，阻断进程抛出警告: ${errMsg}`);
      throw err;
    }

    if (texts.length > 1) {
      console.warn(`[分治恢复-异常捕获] 批次翻译过程抛出错误: ${errMsg}. 自动切分为两部分继续翻译...`);
    } else {
      console.warn(`[分治恢复-异常捕获单体] 翻译单句出错，为了不阻断整档翻译流程，对该段应用术语记忆后放行: ${errMsg}`);
      return applyTerminologyMemoryBatch(texts, glossaryTerms);
    }
  }

  // Self-healing: if sizes don't match, or error occurred (results empty), divide and conquer!
  if (!results || results.length !== texts.length) {
    if (texts.length > 1) {
      console.warn(`[分治恢复] 返回翻译文本数量不匹配或为空 (${results?.length || 0} vs 期望 ${texts.length})。触发自愈：切分为各 50% 比例分治处理...`);
      const mid = Math.floor(texts.length / 2);
      const leftBatch = texts.slice(0, mid);
      const rightBatch = texts.slice(mid);
      
      const leftResults = await translateTextBatch(leftBatch, sourceLang, targetLang, tone, customApi, true);
      const rightResults = await translateTextBatch(rightBatch, sourceLang, targetLang, tone, customApi, true);
      
      return [...leftResults, ...rightResults];
    } else {
      console.warn(`[分治恢复-末端] 单句翻译返回数量仍不正确，安全起见直接降级返回原文。`);
      return texts;
    }
  }

  return results;
}

// Concurrency-limited parallel batch translation engine
async function batchTranslateWithConcurrency(
  pList: { originIdx: number; text: string }[],
  translateFn: (texts: string[]) => Promise<string[]>,
  progress: (msg: string) => void,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  contextName: string = "文档",
  agentPlan?: AgentPlanPayload
): Promise<string[]> {
  const isCustom = !!(customApi && customApi.baseUrl);
  const fallbackBatchSize = isCustom ? 40 : 8;
  const batchSize = estimateAgentBatchSize(agentPlan, fallbackBatchSize);
  const batchDelay = isCustom ? 50 : 1200;
  const concurrency = isAgentPlanEnabled(agentPlan) ? estimateExecutorCount(agentPlan) : (isCustom ? 4 : 1);
  const translations: string[] = new Array(pList.length);

  // Group into batches
  const batches: { originIdx: number; text: string }[][] = [];
  for (let i = 0; i < pList.length; i += batchSize) {
    batches.push(pList.slice(i, i + batchSize));
  }

  const totalBatches = batches.length;
  let completed = 0;
  let activeBatchIdx = 0;

  const worker = async () => {
    while (true) {
      const batchIdx = activeBatchIdx++;
      if (batchIdx >= totalBatches) break;
      
      const batch = batches[batchIdx];
      const batchTexts = batch.map(b => b.text);
      
      progress(`正在编译翻译 ${contextName}: 第 ${batchIdx + 1}/${totalBatches} 组...`);

      try {
        const results = await translateFn(batchTexts);
        batch.forEach((item, bIdx) => {
          translations[item.originIdx] = results[bIdx] || item.text;
        });
      } catch (err: any) {
        console.error(`Batch error in ${contextName}:`, err.message);
        throw err;
      }

      completed += batch.length;
      progress(`翻译 ${contextName} 进度: ${completed}/${pList.length} (${Math.round(completed * 100 / pList.length)}%)...`);

      if (batchDelay > 0 && activeBatchIdx < totalBatches) {
        await delay(batchDelay);
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, totalBatches) }, () => worker());
  await Promise.all(workers);

  return translations;
}

// 2. DOCX Translator
export async function translateDocx(
  fileBuffer: Buffer,
  translateFn: (texts: string[]) => Promise<string[]>,
  progress: (msg: string) => void,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  agentPlan?: AgentPlanPayload
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fileBuffer);
  
  // Find all XML documents to translate text runs of paragraphs
  const xmlFiles = Object.keys(zip.files).filter(
    name => name.endsWith('.xml') && !name.includes('[Content_Types]')
  );
  
  let totalParagraphs = 0;
  const fileParagraphs: { fileName: string; xmlContent: string; matches: { fullP: string; originalTexts: string[] }[] }[] = [];
  
  for (const fileName of xmlFiles) {
    const file = zip.file(fileName);
    if (!file) continue;
    
    const xmlContent = await file.async('string');
    // Regex for grabbing paragraph nodes in word document
    const pMatches = xmlContent.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
    if (pMatches.length === 0) continue;
    
    const parsedMatches: { fullP: string; originalTexts: string[] }[] = [];
    for (const p of pMatches) {
      // Find text blocks
      const tMatches = (p.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || []).map(t => {
        const textMatch = t.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/);
        return textMatch ? textMatch[1] : '';
      });
      
      parsedMatches.push({
        fullP: p,
        originalTexts: tMatches
      });
    }
    
    fileParagraphs.push({
      fileName,
      xmlContent,
      matches: parsedMatches
    });
    totalParagraphs += parsedMatches.length;
  }
  
  progress(`成功提取 DOCX 文件共 ${totalParagraphs} 个文本段落...`);
  
  // Collect non-empty texts to batch translate
  const pList: { originIdx: number; text: string; fileIndex: number; pIndex: number }[] = [];
  let itemCounter = 0;
  
  fileParagraphs.forEach((item, fileIdx) => {
    item.matches.forEach((pMatch, pIdx) => {
      const fullPText = pMatch.originalTexts.join('');
      if (fullPText.trim().length > 0) {
        pList.push({
          originIdx: itemCounter++,
          text: fullPText,
          fileIndex: fileIdx,
          pIndex: pIdx
        });
      }
    });
  });
  
  progress(`过滤后共有 ${pList.length} 个待翻译的有效文本块...`);
  
  // Process with concurrency pool
  const translations = await batchTranslateWithConcurrency(pList, translateFn, progress, customApi, "DOCX", agentPlan);
  
  // Reconstruct XML files in Zip
  for (let fileIdx = 0; fileIdx < fileParagraphs.length; fileIdx++) {
    const item = fileParagraphs[fileIdx];
    let updatedXml = item.xmlContent;
    let lastMatchIdx = 0;
    
    for (let pIdx = 0; pIdx < item.matches.length; pIdx++) {
      const pMatch = item.matches[pIdx];
      const fullPText = pMatch.originalTexts.join('');
      
      let replacementP = pMatch.fullP;
      if (fullPText.trim().length > 0) {
        const transRecord = pList.find(r => r.fileIndex === fileIdx && r.pIndex === pIdx);
        if (transRecord) {
          const rawVal = translations[transRecord.originIdx];
          const translatedVal = rawVal && rawVal.trim() !== '' ? rawVal : transRecord.text;
          
          let firstModified = false;
          replacementP = pMatch.fullP.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, (m) => {
            if (!firstModified) {
              firstModified = true;
              const attribsMatch = m.match(/<w:t(\b[^>]*?)>/);
              const attribs = attribsMatch ? attribsMatch[1] : '';
              return `<w:t${attribs}>${escapeXml(translatedVal)}</w:t>`;
            } else {
              const attribsMatch = m.match(/<w:t(\b[^>]*?)>/);
              const attribs = attribsMatch ? attribsMatch[1] : '';
              return `<w:t${attribs}></w:t>`;
            }
          });
        }
      }
      
      const pPos = updatedXml.indexOf(pMatch.fullP, lastMatchIdx);
      if (pPos !== -1) {
        updatedXml = updatedXml.substring(0, pPos) + replacementP + updatedXml.substring(pPos + pMatch.fullP.length);
        lastMatchIdx = pPos + replacementP.length;
      } else {
        updatedXml = updatedXml.replace(pMatch.fullP, () => replacementP);
      }
    }
    
    zip.file(item.fileName, updatedXml);
  }
  
  progress(`重新编译 DOCX 文件归档中...`);
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

// 3. PPTX Translator
async function translatePptx(
  fileBuffer: Buffer,
  translateFn: (texts: string[]) => Promise<string[]>,
  progress: (msg: string) => void,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  agentPlan?: AgentPlanPayload
): Promise<Buffer> {
  console.log(`[translatePptx] Input file buffer length: ${fileBuffer.length} bytes (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  const zip = await JSZip.loadAsync(fileBuffer);
  
  const totalFilesCount = Object.keys(zip.files).length;
  console.log(`[translatePptx] Loaded JSZip instance successfully. Total file streams inside zip container: ${totalFilesCount}`);
  
  // PowerPoint Slides and layers
  const xmlFiles = Object.keys(zip.files).filter(
    name => name.startsWith('ppt/') && name.endsWith('.xml')
  );
  console.log(`[translatePptx] Total XML documents targeting slides and configuration in 'ppt/': ${xmlFiles.length}`);
  
  let totalParagraphs = 0;
  const fileParagraphs: { fileName: string; xmlContent: string; matches: { fullP: string; originalTexts: string[] }[] }[] = [];
  
  for (const fileName of xmlFiles) {
    const file = zip.file(fileName);
    if (!file) continue;
    
    const xmlContent = await file.async('string');
    const pMatches = xmlContent.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) || [];
    if (pMatches.length === 0) continue;
    
    const parsedMatches: { fullP: string; originalTexts: string[] }[] = [];
    for (const p of pMatches) {
      const tMatches = (p.match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g) || []).map(t => {
        const textMatch = t.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/);
        return textMatch ? textMatch[1] : '';
      });
      parsedMatches.push({
        fullP: p,
        originalTexts: tMatches
      });
    }
    
    fileParagraphs.push({
      fileName,
      xmlContent,
      matches: parsedMatches
    });
    totalParagraphs += parsedMatches.length;
  }
  
  progress(`提取幻灯片布局文本共 ${totalParagraphs} 个段落元素...`);
  
  const pList: { originIdx: number; text: string; fileIndex: number; pIndex: number }[] = [];
  let itemCounter = 0;
  
  fileParagraphs.forEach((item, fileIdx) => {
    item.matches.forEach((pMatch, pIdx) => {
      const fullPText = pMatch.originalTexts.join('');
      if (fullPText.trim().length > 0) {
        pList.push({
          originIdx: itemCounter++,
          text: fullPText,
          fileIndex: fileIdx,
          pIndex: pIdx
        });
      }
    });
  });
  
  progress(`过滤后存在 ${pList.length} 个非空幻灯片文本项进行翻译...`);
  
  // Process with concurrency pool
  const translations = await batchTranslateWithConcurrency(pList, translateFn, progress, customApi, "PPTX", agentPlan);
  
  for (let fileIdx = 0; fileIdx < fileParagraphs.length; fileIdx++) {
    const item = fileParagraphs[fileIdx];
    let updatedXml = item.xmlContent;
    let lastMatchIdx = 0;
    
    for (let pIdx = 0; pIdx < item.matches.length; pIdx++) {
      const pMatch = item.matches[pIdx];
      const fullPText = pMatch.originalTexts.join('');
      
      let replacementP = pMatch.fullP;
      if (fullPText.trim().length > 0) {
        const transRecord = pList.find(r => r.fileIndex === fileIdx && r.pIndex === pIdx);
        if (transRecord) {
          const rawVal = translations[transRecord.originIdx];
          const translatedVal = rawVal && rawVal.trim() !== '' ? rawVal : transRecord.text;
          
          let firstModified = false;
          replacementP = pMatch.fullP.replace(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g, (m) => {
            if (!firstModified) {
              firstModified = true;
              return `<a:t>${escapeXml(translatedVal)}</a:t>`;
            } else {
              return `<a:t></a:t>`;
            }
          });
        }
      }
      
      const pPos = updatedXml.indexOf(pMatch.fullP, lastMatchIdx);
      if (pPos !== -1) {
        updatedXml = updatedXml.substring(0, pPos) + replacementP + updatedXml.substring(pPos + pMatch.fullP.length);
        lastMatchIdx = pPos + replacementP.length;
      } else {
        updatedXml = updatedXml.replace(pMatch.fullP, () => replacementP);
      }
    }
    
    zip.file(item.fileName, updatedXml);
  }
  
  progress(`生成重新排版的 PPTX 文件归档中...`);
  console.log(`[translatePptx] Running zip.generateAsync STORE repackaging...`);
  const finalBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  console.log(`[translatePptx] Finished zip generation. Output buffer size: ${finalBuffer.length} bytes (${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  return finalBuffer;
}

// 4. EPUB Translator
async function translateEpub(
  fileBuffer: Buffer,
  translateFn: (texts: string[]) => Promise<string[]>,
  progress: (msg: string) => void,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  agentPlan?: AgentPlanPayload
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fileBuffer);
  
  // XHTML or HTML chapters inside Epub
  const htmlFiles = Object.keys(zip.files).filter(name => {
    const lower = name.toLowerCase();
    return lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm');
  });
  
  let totalBlocks = 0;
  const fileElements: { fileName: string; fileContent: string; elements: { fullTag: string; innerHtml: string }[] }[] = [];
  
  for (const fileName of htmlFiles) {
    const file = zip.file(fileName);
    if (!file) continue;
    
    const content = await file.async('string');
    // Match paragraphs and titles inside epub pages
    const tagRegex = /<(p|h1|h2|h3|h4|h5|h6|li|title|td|blockquote)\b([^>]*?)>([\s\S]*?)<\/\1>/gi;
    let match;
    const elements: { fullTag: string; innerHtml: string }[] = [];
    
    while ((match = tagRegex.exec(content)) !== null) {
      const fullTag = match[0];
      const innerHtml = match[3];
      const textOnly = innerHtml.replace(/<[^>]*>/g, '').trim();
      
      if (textOnly.length > 0) {
        elements.push({
          fullTag,
          innerHtml
        });
      }
    }
    
    if (elements.length > 0) {
      fileElements.push({
        fileName,
        fileContent: content,
        elements
      });
      totalBlocks += elements.length;
    }
  }
  
  progress(`提取 EPUB 书籍中共有 ${totalBlocks} 个文本结构块段。`);
  
  const translateList: { originIdx: number; text: string; fileIndex: number; eleIndex: number }[] = [];
  let itemCounter = 0;
  
  fileElements.forEach((item, fileIdx) => {
    item.elements.forEach((ele, eleIdx) => {
      translateList.push({
        originIdx: itemCounter++,
        text: ele.innerHtml,
        fileIndex: fileIdx,
        eleIndex: eleIdx
      });
    });
  });
  
  // Process with concurrency pool
  const translations = await batchTranslateWithConcurrency(translateList, translateFn, progress, customApi, "EPUB", agentPlan);
  
  for (let fileIdx = 0; fileIdx < fileElements.length; fileIdx++) {
    const item = fileElements[fileIdx];
    let updatedContent = item.fileContent;
    let lastMatchIdx = 0;
    
    for (let eleIdx = 0; eleIdx < item.elements.length; eleIdx++) {
      const ele = item.elements[eleIdx];
      const record = translateList.find(r => r.fileIndex === fileIdx && r.eleIndex === eleIdx);
      
      if (record) {
        const translatedHtmlVal = translations[record.originIdx];
        const tagMatch = ele.fullTag.match(/^<([a-zA-Z1-6]+)\b([^>]*?)>([\s\S]*?)<\/\1>$/i);
        
        if (tagMatch) {
          const tag = tagMatch[1];
          const attribs = tagMatch[2];
          const replacement = `<${tag}${attribs}>${translatedHtmlVal}</${tag}>`;
          
          const pos = updatedContent.indexOf(ele.fullTag, lastMatchIdx);
          if (pos !== -1) {
            updatedContent = updatedContent.substring(0, pos) + replacement + updatedContent.substring(pos + ele.fullTag.length);
            lastMatchIdx = pos + replacement.length;
          } else {
            updatedContent = updatedContent.replace(ele.fullTag, () => replacement);
          }
        }
      }
    }
    
    zip.file(item.fileName, updatedContent);
  }
  
  progress(`打包 EPUB 并保留完美排版...`);
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

// 5. MARKTOWN (.md) Translator
async function translateMarkdown(
  fileBuffer: Buffer,
  translateFn: (texts: string[]) => Promise<string[]>,
  progress: (msg: string) => void,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  agentPlan?: AgentPlanPayload
): Promise<Buffer> {
  const mdContent = fileBuffer.toString('utf8');
  const blocks = mdContent.split(/\r?\n\r?\n/);
  
  progress(`成功提取 ${blocks.length} 个 Markdown 文本大块区域.`);
  
  const translateList: { originIdx: number; text: string }[] = [];
  const processedBlocks: string[] = [...blocks];
  
  blocks.forEach((blk, idx) => {
    const trimmed = blk.trim();
    if (trimmed.length > 0) {
      // Keep lists, paragraphs, headers and ask LLM to maintain MD tags
      translateList.push({
        originIdx: idx,
        text: blk
      });
    }
  });
  
  // Process with concurrency pool
  const translations = await batchTranslateWithConcurrency(translateList, translateFn, progress, customApi, "MD语段", agentPlan);
  
  translateList.forEach((item) => {
    processedBlocks[item.originIdx] = translations[item.originIdx];
  });
  
  const finalMd = processedBlocks.join('\n\n');
  return Buffer.from(finalMd, 'utf8');
}

// Helper: Merge raw extracted PDF lines into cohesive paragraphs
function reconstructParagraphs(pageText: string): string[] {
  const lines = pageText.split('\n').map(l => l.trim());
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (const line of lines) {
    if (!line) {
      if (currentParagraph) {
        paragraphs.push(currentParagraph.trim());
        currentParagraph = '';
      }
      continue;
    }

    // Heuristic: If it is a bullet, header, list item or very short, push it as a distinct block
    const isSpecialLine = /^(?:[0-9]+(?:\.[0-9]+)*|\*|-|•|◆|Section|Chapter|Title|Page)\b/.test(line) || line.length < 25;

    if (isSpecialLine) {
      if (currentParagraph) {
        paragraphs.push(currentParagraph.trim());
        currentParagraph = '';
      }
      paragraphs.push(line);
      continue;
    }

    if (currentParagraph) {
      if (currentParagraph.endsWith('-')) {
        currentParagraph = currentParagraph.slice(0, -1) + line;
      } else {
        const lastChar = currentParagraph.slice(-1);
        const isEastAsian = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(lastChar);
        if (isEastAsian) {
          currentParagraph += line;
        } else {
          currentParagraph += ' ' + line;
        }
      }
    } else {
      currentParagraph = line;
    }

    // If the line ends with a standard terminal punctuation, flush
    const endsWithTerminal = /[.:!?。！？’”」]$/.test(line);
    if (endsWithTerminal || line.length < 50) {
      paragraphs.push(currentParagraph.trim());
      currentParagraph = '';
    }
  }

  if (currentParagraph) {
    paragraphs.push(currentParagraph.trim());
  }

  return paragraphs.filter(p => p.length > 0);
}

// 6. PDF Parser & Builder (Translates page blocks and exports DOCX text & styled PDF report)
async function translatePdf(
  fileBuffer: Buffer,
  translateFn: (texts: string[]) => Promise<string[]>,
  progress: (msg: string) => void,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  targetLang: string = "zh",
  agentPlan?: AgentPlanPayload
): Promise<{ docxBuffer: Buffer; pdfBuffer: Buffer; textContent: string }> {
  progress(`正在读取并解析 PDF 文本排版数据...`);
  const data = await pdfParse(fileBuffer);
  const fullText = data.text;

  const pages = fullText.split('\f').map(p => p.trim()).filter(p => p.length > 0);
  progress(`PDF 成功被解构为 ${pages.length} 页独立内容.`);

  const pList: { text: string; pageIdx: number }[] = [];
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageParagraphs = reconstructParagraphs(pages[pIdx]);
    for (const txt of pageParagraphs) {
      if (txt.trim()) {
        pList.push({ text: txt, pageIdx: pIdx });
      }
    }
  }

  progress(`过滤提取出共有 ${pList.length} 个待排版翻译的有效文本块...`);
  const pListWithIdx = pList.map((item, idx) => ({ originIdx: idx, text: item.text }));
  const translations = await batchTranslateWithConcurrency(pListWithIdx, translateFn, progress, customApi, "PDF段落", agentPlan);
  console.log('[translatePdf] pList sample', pList.slice(0, 5));
  console.log('[translatePdf] translations sample', translations.slice(0, 5));

  const translatedPages: string[] = [];
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageLines: string[] = [];
    pList.forEach((item, idx) => {
      if (item.pageIdx === pIdx) {
        const translated = (translations[idx] || '').trim();
        pageLines.push(translated || item.text);
      }
    });
    translatedPages.push(pageLines.join('\n\n'));
  }

  const fullTranslatedContent = translatedPages.join('\n\n---\n\n');

  progress(`构建双栏版面高保真对照 PDF 工作面...`);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as any);

  const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fallbackBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let customFont: any = null;
  try {
    const localFontBuffer = await loadLocalPdfFontBuffer(targetLang);
    if (localFontBuffer) {
      customFont = await pdfDoc.embedFont(localFontBuffer, { subset: true });
      console.log('[PDF font] custom font loaded', { targetLang, hasCustomFont: !!customFont });
      progress(`本地高保真字体加载成功，已启用 CJK 矢量字形嵌入。`);
    } else {
      progress(`未找到合适的本地 CJK 字体，将退回基础字体输出。`);
    }
  } catch (e: any) {
    console.warn('[PDF font load failed]', e?.message || e);
    progress(`本地高保真字体加载失败，将退回基础字体输出。`);
  }

  const font = customFont || fallbackFont;
  const boldFont = customFont || fallbackBoldFont;
  const topY = 790;
  const bottomMargin = 55;
  const maxWidth = 595.276 - 100;

  let pageNumber = 1;
  let page = addPdfPage(pdfDoc, pageNumber, font);
  const state = { y: topY, pageNumber };

  for (let pIdx = 0; pIdx < translatedPages.length; pIdx++) {
    const pageText = translatedPages[pIdx].trim();
    if (!pageText) continue;

    const headerLines = wrapHybridText(`PDF Translation · Source Page ${pIdx + 1}`, boldFont, 11, maxWidth);
    page = drawWrappedBlock(pdfDoc, page, headerLines, state, boldFont, 11, 16, topY, bottomMargin);
    state.y -= 4;

    const paragraphs = pageText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const lines = wrapHybridText(paragraph, font, 9.5, maxWidth);
      page = drawWrappedBlock(pdfDoc, page, lines, state, font, 9.5, 14, topY, bottomMargin);
      state.y -= 8;
    }

    state.y -= 10;
    pageNumber = state.pageNumber;
  }

  const pdfBytes = await pdfDoc.save();

  return {
    docxBuffer: Buffer.from(fullTranslatedContent, 'utf8'),
    pdfBuffer: Buffer.from(pdfBytes),
    textContent: fullTranslatedContent
  };
}

// ── translatePdfViaWorkflow: unified v3 workflow (page-wise API + white-rect overlay + glossary) ──
const WORKFLOW_SCRIPT = realScriptPath('scripts/pdf_translate_workflow.py');

async function translatePdfViaWorkflow(
 fileBuffer: Buffer,
 progress: (msg: string) => void,
 customApi: CustomApiConfig,
 sourceLang: string | undefined,
 targetLang: string,
 glossaryTerms?: { source: string; target: string }[]
): Promise<{ docxBuffer: Buffer; pdfBuffer: Buffer; textContent: string }> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'joebook-workflow-'));
  const inputPath = path.join(tempDir, 'input.pdf');
  const outputPath = path.join(tempDir, 'output.pdf');

  try {
    await fs.promises.writeFile(inputPath, fileBuffer);
    progress('启动 PDF 高保真翻译引擎（逐 span 识别 + 白底黑字精细覆盖 + 专业术语修正）...');

    const args = [
      WORKFLOW_SCRIPT,
      inputPath,
      '--output', outputPath,
      '--base-url', String(customApi?.baseUrl || 'http://127.0.0.1:1234/v1').trim(),
      '--model', String(customApi?.model || 'gemma-4-e4b-it-mlx').trim(),
 '--api-key', customApi?.apiKey || 'not-required',
 '--lang-in', normalizePdf2zhLang(sourceLang),
 '--lang-out', normalizePdf2zhLang(targetLang),
 '--timeout', '120',
 '--batch-size', '10',
 ];

 // Write glossary terms to temp JSON file for Python workflow
 let glossaryJsonPath: string | null = null;
 if (glossaryTerms && glossaryTerms.length > 0) {
 try {
 glossaryJsonPath = path.join(tempDir, 'glossary.json');
 await fs.promises.writeFile(glossaryJsonPath, JSON.stringify(glossaryTerms, null, 2));
 args.push('--glossary-json', glossaryJsonPath);
 } catch (e) { console.warn('[workflow] Failed to write glossary JSON:', e); }
 }

    console.log('[workflow] args:', args.slice(0, -3).join(' '), '...');
    const { stdout, stderr } = await execFileAsync(PDF2ZH_PYTHON, args, {
      cwd: APP_ROOT_REAL,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 900000, // 15 minutes for large PDFs
    });
    if (stderr?.trim()) console.warn('[workflow stderr]', stderr.trim());
    console.log('[workflow stdout]', stdout.trim());

    // Read output PDF
    let pdfBuffer: Buffer;
    if (fs.existsSync(outputPath)) {
      pdfBuffer = await fs.promises.readFile(outputPath);
    } else {
      // Fallback: try step1 output (translated but not glossary-fixed)
      const fallbackPath = path.join(tempDir, 'input_zh_translated.pdf');
      pdfBuffer = fs.existsSync(fallbackPath)
        ? await fs.promises.readFile(fallbackPath)
        : fileBuffer; // last resort: return original
    }

    // Extract text content for docx output
    let textContent = '';
    try {
      const resultJsonPath = path.join(tempDir, 'output_result.json');
      if (fs.existsSync(resultJsonPath)) {
        const meta = JSON.parse(await fs.promises.readFile(resultJsonPath, 'utf8'));
        textContent = JSON.stringify(meta, null, 2);
      } else {
        const pdfParseMod = await import('pdf-parse');
        const parser = new pdfParseMod.PDFParse({ data: new Uint8Array(pdfBuffer) });
        const result = await parser.getText();
        textContent = result.pages.map((p: any) => p.text).join('\n');
      }
    } catch { textContent = '(text extraction unavailable)'; }

    progress(`PDF 高保真翻译完成：${pdfBuffer.length} bytes`);
    return {
      docxBuffer: Buffer.from(textContent, 'utf8'),
      pdfBuffer,
      textContent,
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Global active operations tracking progress
const activeSessions: Record<string, { status: string; progress: number; outputReady?: boolean; error?: boolean; errorMsg?: string }> = {};

// HTTP API: Translation Controller Route
const translationCaches: Record<string, {
  isJson: boolean;
  mimeType?: string;
  outputName?: string;
  buffer?: Buffer;
  payload?: any;
  cleanupScheduled?: boolean;
  _createdAt?: number;
}> = {};

// Periodic cleanup: sweep stale caches every 5 minutes (TTL: 30 min)
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(translationCaches)) {
    const ttl = translationCaches[key]._createdAt ? (now - translationCaches[key]._createdAt!) : Infinity;
    if (ttl > 30 * 60 * 1000) {
      delete translationCaches[key];
      if (activeSessions[key]) delete activeSessions[key];
    }
  }
}, 5 * 60 * 1000);

app.post('/api/translate', upload.single('file'), async (req, res): Promise<any> => {
  const file = req.file;
  if (!file || !file.buffer || file.buffer.length === 0) {
    return res.status(400).json({ error: '上传的文件内容为空' });
  }
  
  const { sourceLang, targetLang, tone, sessionId } = req.body;
  if (!targetLang) {
    return res.status(400).json({ error: '请选择合理的目标翻译语言。' });
  }

  // Parse custom API configuration if included
  let customApi: { apiKey?: string; baseUrl?: string; model?: string } | undefined;
  if (req.body.customApiKey && req.body.customBaseUrl) {
    customApi = {
      apiKey: req.body.customApiKey,
      baseUrl: req.body.customBaseUrl,
      model: req.body.customModel
    };
  }

 const sId = sessionId || Math.random().toString(36).substring(2);
 const originalName = file.originalname;
 const ext = path.extname(originalName).toLowerCase();

 const parsedGlossary = parseJsonField<any[]>(req.body.glossaryTerms);
 let glossaryTerms = Array.isArray(parsedGlossary) && parsedGlossary.length > 0
 ? parsedGlossary.map((t: any) => ({ source: String(t.source), target: String(t.target) }))
 : undefined;
  const agentPlan = parseJsonField<AgentPlanPayload>(req.body.agentPlan);
  if (agentPlan?.summary) console.log('[agent orchestration]', agentPlan.summary);

  // Session state updates for progress bar reporting
  const updateProgress = (pct: number, statusText: string) => {
    activeSessions[sId] = { status: statusText, progress: pct };
    console.log(`[Session: ${sId}] ${pct}%: ${statusText}`);
  };
  
  updateProgress(10, `开始解析文档并初始化翻译引擎...`);

 // Execute in background
 Promise.resolve().then(async () => {
 try {
 // Planner phase: lazily triggered on first batch (since document text is only available inside translateDocx/translateEpub/etc.)
 let plannerExecuted = false;
 const translateRunner = async (textBatch: string[]): Promise<string[]> => {
 // Lazy planner: analyze the first batch of text to extract key terms
 if (!plannerExecuted && isAgentPlanEnabled(agentPlan)) {
 plannerExecuted = true;
 const plannerApi = apiForRole(agentPlan, 'planner', customApi);
 if (plannerApi?.baseUrl) {
 try {
 updateProgress(12, '规划智能体分析文档结构与关键术语...');
 const planResult = await plannerAnalyze(textBatch, sourceLang, targetLang, tone, plannerApi, glossaryTerms);
 if (planResult.keyTerms.length > 0) {
 glossaryTerms = [...(glossaryTerms || []), ...planResult.keyTerms];
 console.log(`[planner] Strategy: ${planResult.strategy}; Added ${planResult.keyTerms.length} key terms`);
 updateProgress(15, `规划完成: ${planResult.strategy}; 提取 ${planResult.keyTerms.length} 个关键术语`);
 } else {
 console.log(`[planner] Strategy: ${planResult.strategy}; No additional key terms`);
 updateProgress(15, `规划完成: ${planResult.strategy}`);
 }
 } catch (err: any) {
 console.warn('[planner] Analysis failed, continuing with default strategy:', err.message);
 updateProgress(15, '规划智能体分析失败，使用默认策略继续...');
 }
 }
 }

 let translated = await translateTextBatch(textBatch, sourceLang, targetLang, tone, apiForRole(agentPlan, 'executor', customApi), false, glossaryTerms);
 // Proofreader phase: if agent plan is enabled and proofreader API is configured
 if (isAgentPlanEnabled(agentPlan)) {
 const proofreaderApi = apiForRole(agentPlan, 'proofreader', customApi);
 if (proofreaderApi?.baseUrl) {
 try {
 translated = await proofreadBatch(textBatch, translated, sourceLang, targetLang, proofreaderApi, glossaryTerms);
 } catch (err: any) {
 console.warn('[proofreader] Batch proofreading failed:', err.message);
 }
 }
 }
 console.log('[translateRunner] batch in', textBatch);
 console.log('[translateRunner] batch out', translated);
 return translated;
 };

      let outputBuffer: Buffer | null = null;
      let outputName = '';
      let mimeType = 'application/octet-stream';
      let jsonPayload: any = null;

      if (ext === '.docx') {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        outputBuffer = await translateDocx(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, agentPlan);
        outputName = originalName.replace(/\.docx$/i, `_${targetLang}.docx`);
      } else if (ext === '.pptx') {
        mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        outputBuffer = await translatePptx(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, agentPlan);
        outputName = originalName.replace(/\.pptx$/i, `_${targetLang}.pptx`);
      } else if (ext === '.epub') {
        mimeType = 'application/epub+zip';
        outputBuffer = await translateEpub(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, agentPlan);
        outputName = originalName.replace(/\.epub$/i, `_${targetLang}.epub`);
      } else if (ext === '.md') {
        mimeType = 'text/markdown';
        outputBuffer = await translateMarkdown(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, agentPlan);
        outputName = originalName.replace(/\.md$/i, `_${targetLang}.md`);
      } else if (ext === '.pdf') {
        let pdfOut;
        const hasPython = (() => { try { execSync(`${PDF2ZH_PYTHON} --version`, {stdio:'pipe', timeout:3000}); return true; } catch { return false; } })();
        const canRunPythonScripts = hasPython && scriptExists('scripts/pdf_translate_workflow.py') && scriptExists('scripts/pdf_translate_via_pymupdf.py') && scriptExists('scripts/pdf_translate_via_pdf2zh.py');
        if (!canRunPythonScripts) {
          updateProgress(15, '使用内置 PDF 翻译引擎（纯 Node.js 无外部依赖）...');
          pdfOut = await translatePdf(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, targetLang, agentPlan);
        } else {
          // Python available: run unified workflow (逐 span API 翻译 + 白底黑字精确覆盖 + 术语修正)
          try {
            updateProgress(15, '使用 Python 高保真工作流（逐 span 识别 + 白底黑字精细覆盖 + 专业术语修正）...');
            pdfOut = await translatePdfViaWorkflow(file.buffer, (msg) => updateProgress(25, msg), customApi || {}, sourceLang, targetLang, glossaryTerms);
          } catch (workflowErr: any) {
            console.warn('[workflow fallback]', workflowErr?.message || workflowErr);
            // Fallback to PyMuPDF if custom API is configured
            if (canUsePymupdf(customApi)) {
              try {
                updateProgress(35, 'High-fidelity workflow failed, falling back to PyMuPDF engine...');
                pdfOut = await translatePdfViaPymupdf(file.buffer, (msg) => updateProgress(25, msg), customApi!, sourceLang, targetLang);
              } catch (pymupdfErr: any) {
                console.warn('[pymupdf fallback]', pymupdfErr?.message || pymupdfErr);
                if (canUsePdf2zh(customApi)) {
                  try {
                    updateProgress(45, 'PyMuPDF failed, falling back to PDFMathTranslate engine...');
                    pdfOut = await translatePdfViaPdf2zh(file.buffer, (msg) => updateProgress(25, msg), customApi!, sourceLang, targetLang);
                  } catch (pdf2zhErr: any) {
                    console.warn('[pdf2zh fallback]', pdf2zhErr?.message || pdf2zhErr);
                    updateProgress(55, 'All Python engines failed, falling back to basic text-only PDF rebuilder...');
                    pdfOut = await translatePdf(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, targetLang, agentPlan);
                  }
                } else {
                  updateProgress(45, 'No pdf2zh API config, falling back to basic text-only PDF rebuilder...');
                  pdfOut = await translatePdf(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, targetLang, agentPlan);
                }
              }
            } else if (canUsePdf2zh(customApi)) {
              try {
                updateProgress(35, 'High-fidelity workflow failed, falling back to PDFMathTranslate engine...');
                pdfOut = await translatePdfViaPdf2zh(file.buffer, (msg) => updateProgress(25, msg), customApi!, sourceLang, targetLang);
              } catch (pdf2zhErr: any) {
                console.warn('[pdf2zh fallback]', pdf2zhErr?.message || pdf2zhErr);
                updateProgress(45, 'PDFMathTranslate failed, falling back to basic text-only PDF rebuilder...');
                pdfOut = await translatePdf(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, targetLang, agentPlan);
              }
            } else {
              updateProgress(35, 'No custom API config available, using basic text-only PDF rebuilder...');
              pdfOut = await translatePdf(file.buffer, translateRunner, (msg) => updateProgress(25, msg), customApi, targetLang, agentPlan);
            }
          }
        }
        jsonPayload = {
          docxBase64: pdfOut.docxBuffer.toString('base64'),
          pdfBase64: pdfOut.pdfBuffer.toString('base64'),
          textContent: pdfOut.textContent,
          outputName: originalName.replace(/\.pdf$/i, `_${targetLang}.pdf`),
          docxName: originalName.replace(/\.pdf$/i, `_${targetLang}_text.txt`)
        };
      } else {
        throw new Error(`不支持的文件格式 ${ext}。目前支持 pptx, docx, epub, pdf, md。`);
      }

      if (jsonPayload) {
        translationCaches[sId] = { isJson: true, payload: jsonPayload, _createdAt: Date.now() };
      } else if (outputBuffer) {
        translationCaches[sId] = { isJson: false, buffer: outputBuffer, mimeType, outputName, _createdAt: Date.now() };
      }

      updateProgress(100, '翻译与排版完成！文档在缓存中准备下载...');
      if (activeSessions[sId]) activeSessions[sId].outputReady = true;

 } catch (err: any) {
 console.error(`Error during background translation handling:`, err);
 let errorMsg = err.message || 'Unknown translation error';
 if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('denied access')) {
 errorMsg = '【引擎访问限制 / 403 PERMISSION_DENIED】翻译模型接口返回权限拒绝错误。请检查 API Key 是否有效、是否有余额。点击页面右上角【设置 (齿轮) 按钮】，确认【第三方及自建模型】配置正确。\\n\\n[Platform Info] API returned 403 PERMISSION_DENIED. Please verify your API Key and check the Settings panel for correct model configuration.';
 }
 if (errorMsg.includes('LLM API error') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('fetch failed')) {
 errorMsg = `【模型接口连接失败】${errorMsg}\n\n请检查 API Base URL 和 Model 是否正确配置。如启用了智能体编排，请确认各角色模型档案已正确设置。`;
 }
 activeSessions[sId] = { status: `出错: ${errorMsg}`, progress: -1, error: true, errorMsg };
 }
  });

  return res.json({ started: true, sessionId: sId });
});

app.get('/api/translate-download/:sessionId', (req, res): any => {
  try {
    const sId = req.params.sessionId;
    const cache = translationCaches[sId];
    
    if (!cache) {
      return res.status(404).json({ error: '翻译缓存找不到或已过期，请重新发起文件翻译请求。' });
    }

    // Schedule cleanup after 10 minutes instead of immediate deletion
    // This allows the client to retry or handle connection hiccups
    if (!cache.cleanupScheduled) {
      cache.cleanupScheduled = true;
      setTimeout(() => {
        delete translationCaches[sId];
        if (activeSessions[sId]) delete activeSessions[sId];
      }, 10 * 60 * 1000);
    }

    if (cache.isJson) {
      res.setHeader('Content-Type', 'application/json');
      const payloadStr = JSON.stringify(cache.payload);
      res.write(payloadStr);
      res.end();
    } else {
      let safeFilename = 'downloaded_file';
      try {
        if (cache.outputName) {
          safeFilename = encodeURIComponent(cache.outputName);
        }
      } catch (e) {
        // Fallback for surrogate pairs/invalid URI components
        safeFilename = 'translated_document.bin';
      }

      res.setHeader('Content-Type', cache.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.write(cache.buffer!);
      res.end();
    }
  } catch (err: any) {
    console.error('Download Route Error:', err);
    return res.status(500).json({ error: '服务端打包下载失败，请联系管理员。详情: ' + (err.message || String(err)) });
  }
});

// Provide progress updates to client
app.get('/api/progress/:sessionId', (req, res) => {
  const sId = req.params.sessionId;
  const state = activeSessions[sId];
  if (state) {
    res.json(state);
  } else {
    res.json({ status: '等待任务中...', progress: 0 });
  }
});

// Interactive: Stateless parse of document into raw readable paragraphs
app.post('/api/parse-document', upload.single('file'), async (req, res): Promise<any> => {
  const file = req.file;
  if (!file || file.size === 0 || !file.buffer || file.buffer.length === 0) {
    return res.status(400).json({ error: '您提交的文档内容为空（大小为0字节）。若该界面加载自历史记录，受制于浏览器本地存储空间，未能完整离线缓存原始源文件，请在页顶重新拖放/上传您的原始文档后点击分步校对。' });
  }

  const originalName = file.originalname;
  const ext = path.extname(originalName).toLowerCase();

  try {
    let paragraphs: string[] = [];

    if (ext === '.docx') {
      const zip = await JSZip.loadAsync(file.buffer);
      const xmlFiles = Object.keys(zip.files).filter(
        name => name.endsWith('.xml') && !name.includes('[Content_Types]')
      );
      for (const fileName of xmlFiles) {
        const fileContent = zip.file(fileName);
        if (!fileContent) continue;
        const xmlText = await fileContent.async('string');
        const pMatches = xmlText.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
        for (const p of pMatches) {
          const tMatches = (p.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || []).map(t => {
            const m = t.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/);
            return m ? m[1] : '';
          });
          const fullPText = tMatches.join('');
          if (fullPText.trim().length > 0) {
            paragraphs.push(fullPText);
          }
        }
      }
    } else if (ext === '.pptx') {
      const zip = await JSZip.loadAsync(file.buffer);
      const xmlFiles = Object.keys(zip.files).filter(
        name => name.startsWith('ppt/') && name.endsWith('.xml')
      );
      for (const fileName of xmlFiles) {
        const fileContent = zip.file(fileName);
        if (!fileContent) continue;
        const xmlText = await fileContent.async('string');
        const pMatches = xmlText.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) || [];
        for (const p of pMatches) {
          const tMatches = (p.match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g) || []).map(t => {
            const m = t.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/);
            return m ? m[1] : '';
          });
          const fullPText = tMatches.join('');
          if (fullPText.trim().length > 0) {
            paragraphs.push(fullPText);
          }
        }
      }
    } else if (ext === '.epub') {
      const zip = await JSZip.loadAsync(file.buffer);
      const htmlFiles = Object.keys(zip.files).filter(name => {
        const lower = name.toLowerCase();
        return lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.htm');
      });
      for (const fileName of htmlFiles) {
        const fileContent = zip.file(fileName);
        if (!fileContent) continue;
        const content = await fileContent.async('string');
        const tagRegex = /<(p|h1|h2|h3|h4|h5|h6|li|title|td|blockquote)\b([^>]*?)>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = tagRegex.exec(content)) !== null) {
          const innerHtml = match[3];
          const textOnly = innerHtml.replace(/<[^>]*>/g, '').trim();
          if (textOnly.length > 0) {
            paragraphs.push(innerHtml);
          }
        }
      }
    } else if (ext === '.md') {
      const mdContent = file.buffer.toString('utf8');
      const blocks = mdContent.split(/\r?\n\r?\n/);
      for (const blk of blocks) {
        if (blk.trim().length > 0) {
          paragraphs.push(blk);
        }
      }
    } else if (ext === '.pdf') {
      const pData = await pdfParse(file.buffer);
      const fullText = pData.text;
      const pages = fullText.split('\f').map(p => p.trim()).filter(p => p.length > 0);
      for (const pText of pages) {
        const pageParagraphs = reconstructParagraphs(pText);
        paragraphs.push(...pageParagraphs);
      }
    } else {
      return res.status(400).json({ error: `不支持的分步校对格式 ${ext}。目前支持 docx, pptx, epub, md, pdf` });
    }

    return res.json({
      success: true,
      fileType: ext.slice(1),
      fileName: originalName,
      paragraphs: paragraphs
    });
  } catch (err: any) {
    console.error('Error parsing document elements:', err);
    return res.status(500).json({ error: `解析源文件失败: ${err.message}` });
  }
});

// Generic LLM call helper for planner and proofreader roles
async function callLLM(
  customApi: { apiKey?: string; baseUrl?: string; model?: string },
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.3
): Promise<string | null> {
  try {
  let useOfficialGoogleSdk = false;
  if (customApi.apiKey && customApi.apiKey !== 'not-required') {
    const bUrl = customApi.baseUrl || '';
    const mdl = customApi.model || '';
    if (!bUrl || bUrl.includes('googleapis.com') || bUrl.includes('google')) {
      if (mdl.includes('gemini-')) useOfficialGoogleSdk = true;
    }
  }

  if (useOfficialGoogleSdk) {
    const ai = new GoogleGenAI({ apiKey: customApi.apiKey!, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
    const response = await ai.models.generateContent({ model: customApi.model || 'gemini-2.5-flash', contents: userPrompt, config: { systemInstruction: systemPrompt, temperature } });
    return response.text?.trim() || null;
  }

  if (customApi.apiKey && customApi.baseUrl) {
    let rawUrl = customApi.baseUrl.trim().replace(/\/$/, '');
    if (rawUrl.endsWith('/chat/completions')) rawUrl = rawUrl.slice(0, -17);
    else if (rawUrl.endsWith('/chat')) rawUrl = rawUrl.slice(0, -5);

    const bodyObj = {
      model: customApi.model || 'gpt-3.5-turbo',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature,
    };

    const response = await fetch(`${rawUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(customApi.apiKey && customApi.apiKey !== 'not-required' ? { 'Authorization': `Bearer ${customApi.apiKey}` } : {}) },
      body: JSON.stringify(bodyObj),
    });

    if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
    const result = await response.json();
    return result.choices?.[0]?.message?.content?.trim() || null;
  }

  return null;
  } catch (err) {
    console.warn('[callLLM] LLM call failed:', err);
    return null;
  }
}

function plannerSystemPrompt(sourceLang: string, targetLang: string, tone: string, glossaryTerms?: { source: string; target: string }[]): string {
  const glossarySection = glossaryTerms && glossaryTerms.length > 0
    ? `\nExisting terminology mapping:\n${glossaryTerms.map(t => `  ${t.source} → ${t.target}`).join('\n')}`
    : '';
  return `You are a translation planning agent. Analyze the given text segments and output a concise translation strategy as JSON with keys: "strategy" (string: overall approach), "keyTerms" (array of {source, target} objects for critical terms), "notes" (string: any special handling instructions). Keep keyTerms to at most 10 most important items.${glossarySection}`;
}

async function plannerAnalyze(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  tone: string,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  glossaryTerms?: { source: string; target: string }[]
): Promise<{ strategy: string; keyTerms: { source: string; target: string }[]; notes: string }> {
  const defaultResult = { strategy: 'direct', keyTerms: [], notes: '' };
  if (!customApi || !customApi.baseUrl) return defaultResult;
  
  const systemPrompt = plannerSystemPrompt(sourceLang, targetLang, tone, glossaryTerms);
  const userPrompt = `Analyze these ${texts.length} text segments for translation from ${sourceLang} to ${targetLang} (tone: ${tone}):\n${texts.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}${texts.length > 20 ? `\n... and ${texts.length - 20} more segments` : ''}`;

  try {
    const result = await callLLM(customApi, systemPrompt, userPrompt, 0.2);
    if (!result) return defaultResult;
    const cleaned = result.replace(/^```[a-zA-Z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      strategy: String(parsed.strategy || 'direct'),
      keyTerms: Array.isArray(parsed.keyTerms) ? parsed.keyTerms.slice(0, 10).map((t: any) => ({ source: String(t.source || ''), target: String(t.target || '') })).filter((t: any) => t.source && t.target) : [],
      notes: String(parsed.notes || ''),
    };
  } catch (err) {
    console.warn('[plannerAnalyze] Failed, using default strategy:', err);
    return defaultResult;
  }
}

async function proofreadBatch(
  originalTexts: string[],
  translatedTexts: string[],
  sourceLang: string,
  targetLang: string,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string },
  glossaryTerms?: { source: string; target: string }[]
): Promise<string[]> {
  if (!customApi || !customApi.baseUrl) return translatedTexts;
  
  const glossarySection = glossaryTerms && glossaryTerms.length > 0
    ? `\nTerminology requirements:\n${glossaryTerms.map(t => `  ${t.source} → ${t.target}`).join('\n')}`
    : '';

  const systemPrompt = `You are a professional translation proofreader. Review translated text segments and correct any errors. Rules:
1. Fix translation inaccuracies, missing terms, or grammar errors
2. Ensure terminology matches the specified mappings exactly — this is the HIGHEST priority
3. If a translation is already correct, return it unchanged
4. Output ONLY valid JSON: { "corrections": [string, string, ...] } — array must be exactly ${originalTexts.length} items${glossarySection}`;

  const userPrompt = `Review these ${originalTexts.length} translation pairs:\n${originalTexts.slice(0, 30).map((src, i) => `[${i + 1}] Source: ${src}\n    Translation: ${translatedTexts[i]}`).join('\n')}${originalTexts.length > 30 ? `\n... and ${originalTexts.length - 30} more pairs` : ''}\n\nReturn a JSON object with key "corrections" containing an array of corrected translations (same length as input). If a translation is already correct, return it unchanged.`;

 try {
 const result = await callLLM(customApi, systemPrompt, userPrompt, 0.1);
 if (!result) return translatedTexts;
 const cleaned = result.replace(/^```[a-zA-Z]*\n?/i, '').replace(/\n?```$/i, '').trim();
 
 // Try JSON parse first
 try {
 const parsed = JSON.parse(cleaned);
 if (Array.isArray(parsed.corrections) && parsed.corrections.length === translatedTexts.length) {
 return parsed.corrections.map((c: any, i: number) => String(c || translatedTexts[i]));
 }
 // Partial array match
 if (Array.isArray(parsed.corrections) && parsed.corrections.length > 0) {
 return translatedTexts.map((orig, i) => {
 const c = parsed.corrections[i];
 if (c && typeof c === 'string' && c.trim()) return c;
 return orig;
 });
 }
 } catch (jsonErr) {
 // JSON parse failed — model may have returned non-JSON format
 console.warn('[proofreadBatch] JSON parse failed, attempting regex extraction');
 }
 
 // Fallback: try to extract translations from numbered format like [1] Source: ... Translation: ...
 const translationPattern = /Translation:\s*([^\[]*?)(?=\s*\[\d+\]\s*Source:|\s*$)/gi;
 const extracted: string[] = [];
 let match;
 while ((match = translationPattern.exec(cleaned)) !== null) {
 const t = match[1].trim();
 if (t) extracted.push(t);
 }
 if (extracted.length === translatedTexts.length) {
 console.log('[proofreadBatch] Extracted translations from numbered format');
 return extracted;
 }
 
 // Last fallback: return original translations
 return translatedTexts;
 } catch (err) {
 console.warn('[proofreadBatch] Proofreading failed, returning original translations:', err);
 return translatedTexts;
 }
}

// Helper: Polishing a single paragraph translation according to style and targetLang
async function polishTextSingle(
  originalText: string,
  currentTranslation: string,
  targetLang: string,
  style: string,
  customApi?: { apiKey?: string; baseUrl?: string; model?: string }
): Promise<string> {
  const styleDescription = style === 'formal' ? 'scholarly, professional, academic, and elegant' 
                         : style === 'casual' ? 'natural, fluent, idiomatic, and colloquial' 
                         : 'concise, brief, and highly compact';

  const systemInstruction = `You are a bilingually-fluent master document editor. 
Your primary task is to refine, upgrade, and polish the current translation of a given sentence to make it sound incredibly expert, natural, and beautiful in the target language "${targetLang}".
Always match the requested style: ${styleDescription}.`;

  const prompt = `Original sentence (source text): "${originalText}"
Current translation: "${currentTranslation}"
Please refine/polish the current translation into "${targetLang}" so that it is ${styleDescription}.
If the current translation is empty or contains English while target language "${targetLang}" expects another language, you must fully translate it into "${targetLang}" matching the requested style.
Do NOT output anything other than the polished translation. No markdown codeblocks, no explanations, no wrapping quotes. Just send the raw optimized text.`;

  // Detect if we should use official Google GenAI SDK for custom API integrations (rather than general OpenAI completions middleware)
  let useOfficialGoogleSdkForCustomKey = false;
  if (customApi && customApi.apiKey && customApi.apiKey !== 'not-required') {
    const bUrl = customApi.baseUrl || '';
    const mdl = customApi.model || '';
    if (!bUrl || bUrl.includes('googleapis.com') || bUrl.includes('google')) {
      if (mdl.includes('gemini-')) {
        useOfficialGoogleSdkForCustomKey = true;
      }
    }
  }

  if (useOfficialGoogleSdkForCustomKey) {
    const keyToUse = customApi!.apiKey;
    const modelToUse = customApi!.model || 'gemini-2.5-flash';
    
    return await retryWithBackoff(async () => {
      const ai = new GoogleGenAI({
        apiKey: keyToUse!,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await ai.models.generateContent({
 model: modelToUse,
 contents: prompt,
 config: {
 systemInstruction: systemInstruction,
 temperature: 0.3,
 }
 });

 let resultText = response.text?.trim() || currentTranslation;
 resultText = resultText.replace(/^```[a-zA-Z]*\n?/i, '').replace(/\n?```$/i, '').trim();
 if (resultText.startsWith('"') && resultText.endsWith('"')) {
 resultText = resultText.slice(1, -1).trim();
 }
 return resultText;
 }, customApi);
 } else if (customApi && customApi.apiKey && customApi.baseUrl) {
    const baseUrl = customApi.baseUrl.endsWith('/') ? customApi.baseUrl.slice(0, -1) : customApi.baseUrl;
    const model = customApi.model || 'gpt-3.5-turbo';
    
    return await retryWithBackoff(async () => {
      const bodyObj = {
        model: model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${customApi.apiKey}`
        },
        body: JSON.stringify(bodyObj)
      });

      if (!response.ok) {
        throw new Error(`Custom LLM API returned status ${response.status}: ${await response.text()}`);
      }
      
      const result = await response.json();
      let content = result.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Received empty response from custom LLM during polishing.');
      }
      content = content.replace(/^```[a-zA-Z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      if (content.startsWith('"') && content.endsWith('"')) {
        content = content.slice(1, -1).trim();
      }
      return content;
    }, customApi);
 } else {
 // Gemini default API removed — custom API configuration is required
 throw new Error("请先配置翻译模型接口。点击右上角【设置 (⚙ Settings)】，开启【启用第三方自建接口】，选择模型预设并填入 API 地址与密钥。");
 }
}

// Interactive: Translate arbitrary string list with API variables
app.post('/api/translate-chunks', async (req, res): Promise<any> => {
  const { texts, sourceLang, targetLang, tone, polishOnly, currentTranslation } = req.body;
  const agentPlan = parseJsonField<AgentPlanPayload>(req.body.agentPlan);
  if (agentPlan?.summary) console.log('[agent orchestration chunks]', agentPlan.summary);
  if (!texts || !Array.isArray(texts)) {
    return res.status(400).json({ error: '文本列表格式不正确' });
  }

 // Parse custom API config
 let customApi: { apiKey?: string; baseUrl?: string; model?: string } | undefined;
 if (req.body.customApiKey && req.body.customBaseUrl) {
 customApi = {
 apiKey: req.body.customApiKey,
 baseUrl: req.body.customBaseUrl,
 model: req.body.customModel
 };
 }

 // Parse glossary terms
 let glossaryTerms: { source: string; target: string }[] | undefined;
 if (req.body.glossaryTerms) {
 try {
 const parsed = typeof req.body.glossaryTerms === 'string' ? JSON.parse(req.body.glossaryTerms) : req.body.glossaryTerms;
 if (Array.isArray(parsed) && parsed.length > 0) {
 glossaryTerms = parsed.map((t: any) => ({ source: String(t.source), target: String(t.target) }));
 }
 } catch (e) { console.warn('[translate-chunks] Failed to parse glossaryTerms:', e); }
 }

 try {
 if (polishOnly) {
 const originalText = texts[0] || '';
 const polished = await polishTextSingle(originalText, currentTranslation || '', targetLang, tone, apiForRole(agentPlan, 'proofreader', customApi));
 return res.json({ success: true, translations: [polished] });
 } else {
 // Planner phase: if agent plan is enabled, analyze text for key terms
 if (isAgentPlanEnabled(agentPlan)) {
 const plannerApi = apiForRole(agentPlan, 'planner', customApi);
 if (plannerApi?.baseUrl) {
 try {
 const planResult = await plannerAnalyze(texts, sourceLang, targetLang, tone, plannerApi, glossaryTerms);
 // Merge planner's key terms into glossary for this translation
 if (planResult.keyTerms.length > 0) {
 glossaryTerms = [...(glossaryTerms || []), ...planResult.keyTerms];
 console.log(`[planner] Strategy: ${planResult.strategy}; Added ${planResult.keyTerms.length} key terms`);
 }
 } catch (err: any) {
 console.warn('[planner] Analysis failed, continuing with default strategy:', err.message);
 }
 }
 }

 let translations = await translateTextBatch(texts, sourceLang, targetLang, tone, apiForRole(agentPlan, 'executor', customApi), false, glossaryTerms);

 // Proofreader phase: if agent plan is enabled, review and correct translations
 if (isAgentPlanEnabled(agentPlan)) {
 const proofreaderApi = apiForRole(agentPlan, 'proofreader', customApi);
 if (proofreaderApi?.baseUrl) {
 try {
 translations = await proofreadBatch(texts, translations, sourceLang, targetLang, proofreaderApi, glossaryTerms);
 } catch (err: any) {
 console.warn('[proofreader] Batch proofreading failed:', err.message);
 }
 }
 }

 return res.json({ success: true, translations });
 }
 } catch (err: any) {
    console.error('Error translating or polishing chunks:', err);
    let msg = err.message || '翻译段落组出错';
    if (msg.includes('Quota exceeded') || msg.includes('quota') || msg.includes('429_RESOURCE_EXHAUSTED') || msg.includes('429')) {
      msg = "【API 限流 / Quota Exceeded】翻译模型接口触发限流 (429)。请稍等后重试，或切换其他模型/提供商。点击页面右上角 ⚙ 设置 按钮，可更换 API 密钥或模型配置。";
    }
    return res.status(500).json({ error: msg });
  }
});

// Fetch model list from third party or local running API
app.post('/api/fetch-models', async (req, res): Promise<any> => {
  const { baseUrl, apiKey } = req.body;
  if (!baseUrl) {
    return res.status(400).json({ error: 'Base URL is required' });
  }

  let cleanUrl = baseUrl.trim();
  if (cleanUrl.endsWith('/')) {
    cleanUrl = cleanUrl.slice(0, -1);
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey && apiKey !== 'not-required') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let targetUrl = `${cleanUrl}/models`;
    let response;
    let fetchError: Error | null = null;

    try {
      response = await fetch(targetUrl, { method: 'GET', headers });
    } catch (err: any) {
      fetchError = err;
    }

    // Attempt standard alternate endpoint if primary fails or returns non-ok
    if ((!response || !response.ok) && !cleanUrl.includes('/v1') && !cleanUrl.includes('11434')) {
      const alternateUrl = `${cleanUrl}/v1/models`;
      try {
        const altResponse = await fetch(alternateUrl, { method: 'GET', headers });
        if (altResponse.ok) {
          response = altResponse;
          targetUrl = alternateUrl;
          fetchError = null;
        }
      } catch (err) {}
    }

    // Try Ollama models API endpoint
    if (!response || !response.ok) {
      const ollamaUrl = cleanUrl.replace(/\/v1$/, '') + '/api/tags';
      try {
        const ollamaResponse = await fetch(ollamaUrl, { method: 'GET' });
        if (ollamaResponse.ok) {
          const data = await ollamaResponse.json();
          if (data && Array.isArray(data.models)) {
            const modelNames = data.models.map((m: any) => m.name);
            return res.json({ success: true, models: modelNames });
          }
        }
      } catch (ollamaErr) {}
    }

    if (fetchError) {
      throw fetchError;
    }

    if (!response || !response.ok) {
      const statusText = response ? `status ${response.status}: ${await response.text().catch(() => '')}` : 'connection failed';
      throw new Error(`Custom LLM API endpoint returned ${statusText}`);
    }

    const data = await response.json();
    
    if (data && Array.isArray(data.data)) {
      const modelNames = data.data.map((m: any) => m.id);
      return res.json({ success: true, models: modelNames });
    }
    
    if (data && Array.isArray(data)) {
      const modelNames = data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name));
      return res.json({ success: true, models: modelNames });
    }

    return res.json({ 
      success: true, 
      models: [], 
      raw: data,
      warning: 'Could not automatically structure model list. Response was not standard OpenAI/Ollama format.' 
    });

  } catch (err: any) {
    console.error('Error fetching models from custom API:', err);
    return res.status(500).json({ error: `无法获取模型列表：${err.message || '网络连接或鉴权失败'}` });
  }
});

// Interactive: Repack layout document based on frontend's custom corrections mapping
app.post('/api/repack-document', upload.single('file'), async (req, res): Promise<any> => {
  const file = req.file;
  if (!file || file.size === 0 || !file.buffer || file.buffer.length === 0) {
    return res.status(400).json({ error: '原始文档已被清理或归零（0字节）。若该界面属于之前的翻译历史存档，由于浏览器本地存储（LocalStorage）配额有限，未能保存大量源二进制数据，请在页面顶端拖放重新上传原始文档后完成该分步校对重组。' });
  }

  const { targetLang, editedTranslationsJson } = req.body;
  if (!editedTranslationsJson) {
    return res.status(400).json({ error: '未找到校对文本。' });
  }

  let editedTranslations: string[] = [];
  try {
    editedTranslations = JSON.parse(editedTranslationsJson);
  } catch (e: any) {
    return res.status(400).json({ error: '校对文本 JSON 格式不正确。' });
  }

  const originalName = file.originalname;
  const ext = path.extname(originalName).toLowerCase();

  try {
    let outputBuffer: Buffer;
    let mimeType = 'application/octet-stream';
    let outputName = originalName;

    let pointer = 0;
    const mockTranslateRunner = async (textBatch: string[]): Promise<string[]> => {
      const list: string[] = [];
      for (const t of textBatch) {
        const val = editedTranslations[pointer];
        list.push(val && val.trim() !== '' ? val : t);
        pointer++;
      }
      return list;
    };

    if (ext === '.docx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outputBuffer = await translateDocx(file.buffer, mockTranslateRunner, () => {});
      outputName = originalName.replace(/\.docx$/i, `_${targetLang}_corrected.docx`);
    } else if (ext === '.pptx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      outputBuffer = await translatePptx(file.buffer, mockTranslateRunner, () => {});
      outputName = originalName.replace(/\.pptx$/i, `_${targetLang}_corrected.pptx`);
    } else if (ext === '.epub') {
      mimeType = 'application/epub+zip';
      outputBuffer = await translateEpub(file.buffer, mockTranslateRunner, () => {});
      outputName = originalName.replace(/\.epub$/i, `_${targetLang}_corrected.epub`);
    } else if (ext === '.md') {
      mimeType = 'text/markdown';
      outputBuffer = await translateMarkdown(file.buffer, mockTranslateRunner, () => {});
      outputName = originalName.replace(/\.md$/i, `_${targetLang}_corrected.md`);
    } else if (ext === '.pdf') {
      const pdfOut = await translatePdf(file.buffer, mockTranslateRunner, () => {}, undefined, targetLang);

      const payload = {
        docxBase64: pdfOut.docxBuffer.toString('base64'),
        pdfBase64: pdfOut.pdfBuffer.toString('base64'),
        textContent: pdfOut.textContent,
        outputName: originalName.replace(/\.pdf$/i, `_${targetLang}_corrected.pdf`),
        docxName: originalName.replace(/\.pdf$/i, `_${targetLang}_corrected_text.txt`)
      };

      return res.json(payload);
    } else {
      return res.status(400).json({ error: `不支持的文件格式 ${ext}` });
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputName)}"`);
    res.write(outputBuffer);
    res.end();
  } catch (err: any) {
    console.error(`Error during interactive repack handling:`, err);
    return res.status(500).json({ error: `重组排版文档失败: ${err.message}` });
  }
});

// macOS M-series Apple Silicon client configuration bundle compiler
app.get('/api/download-mac-kit', async (req, res) => {
  try {
    const zip = new JSZip();
    
    // Add README.md
    const readmeContent = `# JoEbook - macOS Apple Silicon Client Packager

This package provides a highly optimized Electron wrapper to compile a native desktop client of JoEbook specifically tuned for Apple Silicon (M1/M2/M3/M4 chips) architecture.

## Configuration & Customization
Before packaging, you can open \`main.js\` and edit the \`APP_URL\` environment fallback to point to your live URL.

## Setup & Packaging Steps (How to Build your DMG)
1. Double click to extract this package on your macOS computer.
2. Check that Node.js is installed on your Mac.
3. Open your MacOS Terminal and move into this directory:
   \`\`\`bash
   cd joebook-mac-kit
   \`\`\`
4. Grant build permission and execute:
   \`\`\`bash
   chmod +x build-dmg.sh
   ./build-dmg.sh
   \`\`\`
5. Once compiling finishes, locate the ready-to-run \`JoEbook-1.0.0-arm64.dmg\` file in the \`dist/\` folders, and drag-and-drop installer onto your system Applications!`;

    // Add main.js
    const mainJsContent = `const { app, BrowserWindow, Menu, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// IPC: Get save path from renderer (custom or default)
let userSavePath = '';
ipcMain.handle('get-save-path', () => {
  return userSavePath || '';
});
ipcMain.handle('set-save-path', (_event, savePath) => {
  userSavePath = savePath;
  return true;
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "JoEbook",
    titleBarStyle: 'default',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the web app URL. 
  const appURL = process.env.APP_URL || "${req.headers.referer || 'https://ais-dev-jtz4idduxc7va53lohaw7o-283544313319.us-west2.run.app'}";
  mainWindow.loadURL(appURL);

  // Intercept downloads: save without prompting, use custom path or default Downloads
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const defaultDir = app.getPath('downloads');
    const targetDir = userSavePath || defaultDir;
    
    if (!fs.existsSync(targetDir)) {
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch (_) {}
    }
    
    const filePath = path.join(targetDir, item.getFilename());
    item.setSavePath(filePath);
    
    item.on('done', (_event, state) => {
      if (state === 'completed') {
        console.log('Download completed:', filePath);
      }
    });
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'JoEbook',
      submenu: [
        { role: 'about', label: 'About JoEbook' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit App' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ]));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});`;

    // Add preload.js for Electron IPC
    const preloadJsContent = `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSavePath: () => ipcRenderer.invoke('get-save-path'),
  setSavePath: (savePath) => ipcRenderer.invoke('set-save-path', savePath)
});`;

    // Add package.json
    const packageJsonContent = JSON.stringify({
      name: "joebook-mac-kit",
      version: "1.3.0",
      description: "JoEbook native macOS DMG packaging workspace",
      main: "main.js",
      scripts: {
        "start": "electron .",
        "pack:mac": "electron-builder --mac --arm64"
      },
      dependencies: {
        "electron-is-dev": "^2.0.0"
      },
      devDependencies: {
        "electron": "^28.2.0",
        "electron-builder": "^24.9.1"
      },
      build: {
        "appId": "com.jooseed.joebook",
        "productName": "JoEbook",
        "mac": {
          "target": "dmg",
          "arch": [
            "arm64"
          ],
          "category": "public.app-category.productivity"
        },
        "dmg": {
          "title": "Install JoEbook",
          "iconSize": 100,
          "contents": [
            {
              "x": 130,
              "y": 150,
              "type": "dir",
              "path": "/Applications"
            },
            {
              "x": 360,
              "y": 150,
              "type": "file"
            }
          ]
        }
      }
    }, null, 2);

    // Add build-dmg.sh
    const buildDmgShContent = `#!/bin/bash
echo "=========================================================="
echo "          JoEbook | macOS M-Series arm64 DMG Packaging     "
echo "=========================================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not found. Please install it on your Mac first."
    exit 1
fi

echo "[1/3] Clean node_modules directory..."
rm -rf node_modules package-lock.json

echo "[2/3] Installing development dependencies..."
npm install

echo "[3/3] Compiling DMG binary optimized for Apple Silicon..."
npm run pack:mac

echo ""
echo "=========================================================="
echo "Finished! The DMG installer is stored at: ./dist/JoEbook-1.0.0-arm64.dmg"
echo "=========================================================="`;

    // Create folders in ZIP
    zip.file("joebook-mac-kit/README.md", readmeContent);
    zip.file("joebook-mac-kit/main.js", mainJsContent);
    zip.file("joebook-mac-kit/preload.js", preloadJsContent);
    zip.file("joebook-mac-kit/package.json", packageJsonContent);
    zip.file("joebook-mac-kit/build-dmg.sh", buildDmgShContent);

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="joebook-mac-kit.zip"');
    res.write(buffer);
    res.end();
  } catch (err: any) {
    console.error('Error creating macOS DMG packager ZIP:', err);
    return res.status(500).json({ error: `无法创建打包二进制包: ${err.message}` });
  }
});

// ── Multi-Agent Orchestrator API Endpoints ─────────────────────────
// These endpoints bridge the frontend's ModelProfile system to the
// server-side TranslationOrchestrator. Role model configs come from
// the frontend's resolveAgentRoleApis() — NOT hardcoded.

// In-memory orchestrator instances (keyed by documentId), auto-cleaned after 30 min
const orchestratorSessions: Record<string, any> = {};
const ORCHESTRATOR_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanupOrchestratorSessions(): void {
  const now = Date.now();
  for (const key of Object.keys(orchestratorSessions)) {
    if (orchestratorSessions[key]._createdAt && (now - orchestratorSessions[key]._createdAt) > ORCHESTRATOR_SESSION_TTL_MS) {
      delete orchestratorSessions[key];
    }
  }
}
// Run cleanup every 5 minutes
setInterval(cleanupOrchestratorSessions, 5 * 60 * 1000);

// POST /api/orchestrator/run — Start a multi-agent pipeline run
app.post('/api/orchestrator/run', express.json(), async (req: any, res: any) => {
  try {
    const { documentId, fileName, fileType, blocks, sourceLang, targetLang, domain, roleModels, glossaryTerms, fileBuffer } = req.body;

    if (!documentId || !blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: documentId, blocks' });
    }

    // Dynamically import orchestrator (ESM boundary)
    const { TranslationOrchestrator } = await import('./src/orchestrator/translation-orchestrator.js');

    const docAST = {
      documentId,
      fileName: fileName || 'document',
      fileType: fileType || 'docx',
      sourceLang: sourceLang || 'Auto',
      targetLang: targetLang || 'Chinese (Simplified)',
      domain: domain || 'general',
      blocks: blocks.map((b: any, i: number) => ({
        blockId: b.blockId || `block-${i}`,
        text: b.text || '',
        nodeType: b.nodeType || 'paragraph',
        constraint: b.constraint,
        bbox: b.bbox,
        style: b.style,
        domPath: b.domPath || `body/p[${i}]`,
        pageIndex: b.pageIndex,
      })),
    };

  // Require roleModels from frontend — user must configure models in the UI before starting the pipeline.
  // roleModels are resolved from persisted ModelProfile + agentRoleProfileIds in localStorage.
  // No hardcoded fallback: if not provided, return error asking user to configure.
  if (!roleModels || !roleModels.planner?.baseUrl || !roleModels.executor?.baseUrl || !roleModels.proofreader?.baseUrl) {
    return res.status(400).json({
      error: '缺少智能体模型配置。请在"模型管理中心"中为各角色（规划/执行/校对）配置并保存模型档案后再启动翻译流水线。',
      errorEn: 'Missing agent model configuration. Please configure and save model profiles for each role (Planner/Executor/Proofreader) in the Model Management Center before starting the pipeline.',
    });
  }

  const roleModelConfig = roleModels;

    const existingGlossary = glossaryTerms || [];

    // Decode file buffer if provided (needed for file reconstruction after pipeline)
    let fileBufferBuf: Buffer | null = null;
    if (fileBuffer) {
      try {
        fileBufferBuf = Buffer.from(fileBuffer, 'base64');
      } catch (e) {
        console.warn('[orchestrator] Failed to decode fileBuffer:', e);
      }
    }

    const orchestrator = new TranslationOrchestrator(undefined, {
      onProgress: (completed, total, phase) => {
        if (orchestratorSessions[documentId]) {
          orchestratorSessions[documentId].status = `阶段: ${phase} (${completed}/${total} 块)`;
          orchestratorSessions[documentId].progress = Math.round((completed / Math.max(total, 1)) * 100);
        }
      },
    });

    orchestratorSessions[documentId] = {
      status: '初始化编排器...',
      progress: 0,
      phase: 'planning',
      _createdAt: Date.now(),
    };

    // Store file metadata for later reconstruction
    const fileMeta = fileBufferBuf ? {
      fileName,
      fileType,
      sourceLang,
      targetLang,
      tone: req.body.tone || 'general',
      fileBuffer: fileBufferBuf,
    } : null;
    if (fileMeta) {
      (orchestratorSessions[documentId] as any).fileMeta = fileMeta;
    }

    // Run async — return immediately, client polls progress
    const runPromise = orchestrator.run(docAST, roleModelConfig, existingGlossary);
    runPromise.then(async result => {
      orchestratorSessions[documentId].result = result;
      orchestratorSessions[documentId].status = result.success ? '翻译流水线完成' : `失败: ${result.error}`;
      orchestratorSessions[documentId].progress = 100;
      orchestratorSessions[documentId].phase = result.success ? 'completed' : 'failed';

      // After successful pipeline, reconstruct the translated file and store in translationCaches
      if (result.success && result.taskState && fileMeta) {
        try {
          const { getTaskState } = await import('./src/orchestrator/task-state.js');
          const taskState = await getTaskState(documentId);
          if (taskState && taskState.translatedBlocks && taskState.translatedBlocks.length > 0) {
            console.log('[orchestrator] Reconstructing file from', taskState.translatedBlocks.length, 'translated blocks...');
            const reconstructed = await reconstructFileFromBlocks(
              fileMeta.fileBuffer,
              fileMeta.fileName,
              fileMeta.fileType,
              fileMeta.sourceLang,
              fileMeta.targetLang,
              fileMeta.tone,
              taskState.translatedBlocks,
            );
            if (reconstructed) {
              translationCaches[documentId] = {
                buffer: reconstructed.buffer,
                outputName: reconstructed.outputName,
                mimeType: reconstructed.mimeType,
                isJson: false,
                cleanupScheduled: false,
              };
              console.log('[orchestrator] File reconstructed and cached for download:', reconstructed.outputName);
            }
          }
        } catch (reconErr: any) {
          console.error('[orchestrator] File reconstruction failed:', reconErr.message);
        }
      }
    }).catch((err: any) => {
      orchestratorSessions[documentId].status = `编排器错误: ${err?.message || String(err)}`;
      orchestratorSessions[documentId].progress = -1;
      orchestratorSessions[documentId].phase = 'failed';
    });

    return res.json({ started: true, documentId });
  } catch (err: any) {
    console.error('[orchestrator/run] Error:', err);
    return res.status(500).json({ error: `编排器启动失败: ${err?.message || String(err)}` });
  }
});

// GET /api/orchestrator/progress/:documentId — Poll pipeline progress
app.get('/api/orchestrator/progress/:documentId', (req: any, res: any) => {
  const session = orchestratorSessions[req.params.documentId];
  if (!session) {
    return res.json({ status: '未找到任务', progress: 0, phase: 'planning' });
  }
  return res.json(session);
});

// POST /api/orchestrator/polish — Interactive polish via proofreader agent
app.post('/api/orchestrator/polish', express.json(), async (req: any, res: any) => {
  try {
    const { blockId, originalText, translatedText, constraint, action, plan, roleModels, context } = req.body;

    if (!blockId || !translatedText || !action || !plan) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { TranslationOrchestrator } = await import('./src/orchestrator/translation-orchestrator.js');
  if (!roleModels || !roleModels.proofreader?.baseUrl) {
    return res.status(400).json({
      error: '缺少校对智能体模型配置。请在"模型管理中心"中配置并保存模型档案后再使用润色功能。',
      errorEn: 'Missing proofreader model configuration. Please configure and save a model profile in the Model Management Center before using the polish feature.',
    });
  }

  const roleModelConfig = roleModels;

    const orchestrator = new TranslationOrchestrator();
    const polishedText = await orchestrator.polishBlock(
      {
        blockId,
        originalText: originalText || '',
        translatedText,
        preservedTags: [],
        confidence: 0.5,
        domPath: '',
        constraint: constraint || 'ExpandAllowed',
      },
      action,
      plan,
      roleModelConfig.proofreader || {},
      context,
    );

    return res.json({ success: true, polishedText });
  } catch (err: any) {
    console.error('[orchestrator/polish] Error:', err);
    return res.status(500).json({ error: `润色失败: ${err?.message || String(err)}` });
  }
});

// Vite server linkage for React dev server & build production serving
const startExpress = async () => {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // DMG/Production: serve from the same directory as server.cjs (dist/)
    const distPath = path.resolve(__dirname);
    console.log('Serving static from:', distPath);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JoEbook running locally on http://localhost:${PORT}`);
    console.log('[startup] Workflow available:', scriptExists('scripts/pdf_translate_workflow.py'));
    console.log('[startup] hasPython check:', (() => { try { require('child_process').execSync('python3 --version'); return true; } catch { return false; } })());
  });
};

startExpress();

/**
 * Reconstruct a translated file from orchestrator-produced translated blocks.
 * Uses the same translator functions as the standard path, but injects
 * pre-translated text from the orchestrator pipeline instead of calling LLM.
 */
async function reconstructFileFromBlocks(
  fileBuffer: Buffer,
  fileName: string,
  fileType: string,
  sourceLang: string,
  targetLang: string,
  tone: string,
  translatedBlocks: Array<{ blockId: string; originalText: string; translatedText: string; preservedTags?: string[]; domPath?: string }>,
): Promise<{ buffer: Buffer; outputName: string; mimeType: string } | null> {
  try {
    const ext = '.' + (fileType || fileName.split('.').pop()?.toLowerCase());
    const originalName = fileName;
    const baseName = originalName.replace(/\.[^.]+$/, '');
    const outputName = `${baseName}_${targetLang}.${fileType}`;

    // Build a block lookup map: originalText → translatedText
    const blockMap = new Map<string, string>();
    for (const tb of translatedBlocks) {
      blockMap.set(tb.originalText.trim(), tb.translatedText);
    }

    // Create a translateRunner that uses pre-translated blocks instead of calling LLM
    const translateRunner = async (texts: string[]): Promise<string[]> => {
      const results: string[] = [];
      for (const text of texts) {
        const trimmed = text.trim();
        const translated = blockMap.get(trimmed);
        if (translated) {
          results.push(translated);
        } else {
          // Fallback: use original text (shouldn't happen if pipeline completed)
          console.warn('[reconstruct] No translation found for block, using original');
          results.push(text);
        }
      }
      return results;
    };

    const progress = (_msg: string) => {}; // no-op

    let outputBuffer: Buffer;
    let mimeType: string;

    if (ext === '.docx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      outputBuffer = await translateDocx(fileBuffer, translateRunner, progress, undefined, undefined);
    } else if (ext === '.pptx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      outputBuffer = await translatePptx(fileBuffer, translateRunner, progress, undefined, undefined);
    } else if (ext === '.epub') {
      mimeType = 'application/epub+zip';
      outputBuffer = await translateEpub(fileBuffer, translateRunner, progress, undefined, undefined);
    } else if (ext === '.md') {
      mimeType = 'text/markdown';
      outputBuffer = await translateMarkdown(fileBuffer, translateRunner, progress, undefined, undefined);
    } else {
      console.warn('[reconstruct] Unsupported format:', ext);
      return null;
    }

    return { buffer: outputBuffer, outputName, mimeType };
  } catch (err: any) {
    console.error('[reconstruct] File reconstruction error:', err.message);
    return null;
  }
}
