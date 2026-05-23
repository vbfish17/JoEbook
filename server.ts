import express from 'express';
import path from 'path';
import multer from 'multer';
import JSZip from 'jszip';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

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

const app = express();
const DEFAULT_PORT = 7050;
const PORT = Number(process.env.JOEBOOK_PORT || (process.env.NODE_ENV === 'production' ? process.env.PORT : DEFAULT_PORT) || DEFAULT_PORT);
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
  isRecursive = false
): Promise<string[]> {
  const sourceText = sourceLang === 'Auto' ? 'auto-detected language' : sourceLang;
  
  const systemInstruction = `You are a professional bilingually-fluent document translator. 
Your primary task is to translate an array of text segments from "${sourceText}" to "${targetLang}".
Always maintain a "${tone}" tone, natural expression, correct style, and exact formatting placeholders.

CRITICAL RULES:
1. You MUST return translations inside a valid JSON object matching the requested schema.
2. The number of translation strings in the returned "translations" array MUST be exactly identical to the input list (${texts.length} items).
3. Keep all technical terms, markup tags, HTML sub-elements, inline style tokens, variables, or braces (e.g. {1}) exactly as they are. Translate only the surrounding natural text.
4. If a block consists entirely of numbers, code syntax, empty spaces, or placeholder characters, return it unchanged.
5. Return ONLY the JSON response - do not decorate it with markdown codeblocks or other chat text.`;

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
            systemInstruction: systemInstruction,
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
        const prompt = `Translate the following text items. \nInput items list (JSON formatted):\n${JSON.stringify({ paragraphs: texts }, null, 2)}\n\nReturn a JSON with the key "translations" containing the array of translations in the exact same sequence. No explanations and no Markdown blocks.`;

        const makeRequest = async (includeJsonFormat: boolean) => {
          const bodyObj: any = {
            model: model,
            messages: [
              { role: 'system', content: systemInstruction },
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
        
        // Fallback if the raw API endpoint does not support response_format: json_object
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

        // High fidelity parsing function
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
          return data;
        }
        if (data && typeof data === 'object') {
          if (Array.isArray(data.translations)) return data.translations;
          if (Array.isArray(data.translated)) return data.translated;
          if (Array.isArray(data.paragraphs)) return data.paragraphs;
          if (Array.isArray(data.results)) return data.results;
          const foundArray = Object.values(data).find(v => Array.isArray(v));
          if (foundArray) return foundArray;
        }
        return [];
      }, customApi);
    } else {
      // Default Gemini API configuration using @google/genai SDK
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("内置公用 Gemini API Key 未配置。请点击右上角【设置 (⚙ Settings)】，开启【启用第三方自建接口】，在模型预设中选中【Gemini (Google Official)】并妥善填入您個人的 Pro 或 Free Key，即可百分百成功运行并获得高质量排版文档！");
      }
      
      results = await retryWithBackoff(async () => {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY!,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const prompt = `Translate the following text segments. Input array: ${JSON.stringify(texts)}`;
        
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction: systemInstruction,
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
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') {
          if (Array.isArray(data.translations)) return data.translations;
          if (Array.isArray(data.translated)) return data.translated;
          if (Array.isArray(data.paragraphs)) return data.paragraphs;
          if (Array.isArray(data.results)) return data.results;
          const foundArray = Object.values(data).find(v => Array.isArray(v));
          if (foundArray) return foundArray;
        }
        return [];
      }, customApi);
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
      console.warn(`[分治恢复-异常捕获单体] 翻译单句出错，为了不阻断整档翻译流程，对该段放行并保留原文: ${errMsg}`);
      return texts;
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
  contextName: string = "文档"
): Promise<string[]> {
  const isCustom = !!(customApi && customApi.apiKey);
  const batchSize = isCustom ? 40 : 8;
  const batchDelay = isCustom ? 50 : 1200;
  const concurrency = isCustom ? 4 : 1;
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
  customApi?: { apiKey?: string; baseUrl?: string; model?: string }
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
  const translations = await batchTranslateWithConcurrency(pList, translateFn, progress, customApi, "DOCX");
  
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
  customApi?: { apiKey?: string; baseUrl?: string; model?: string }
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
  const translations = await batchTranslateWithConcurrency(pList, translateFn, progress, customApi, "PPTX");
  
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
  customApi?: { apiKey?: string; baseUrl?: string; model?: string }
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
  const translations = await batchTranslateWithConcurrency(translateList, translateFn, progress, customApi, "EPUB");
  
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
  customApi?: { apiKey?: string; baseUrl?: string; model?: string }
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
  const translations = await batchTranslateWithConcurrency(translateList, translateFn, progress, customApi, "MD语段");
  
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
  targetLang: string = "zh"
): Promise<{ docxBuffer: Buffer; pdfBuffer: Buffer; textContent: string }> {
  progress(`正在读取并解析 PDF 文本排版数据...`);
  const data = await pdfParse(fileBuffer);
  const fullText = data.text;
  
  // PDF divides pages with \f
  const pages = fullText.split('\f').map(p => p.trim()).filter(p => p.length > 0);
  progress(`PDF 成功被解构为 ${pages.length} 页独立内容.`);
  
  // Gather all lines across all pages with layout coordinates
  const pList: { text: string; pageIdx: number }[] = [];
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pText = pages[pIdx];
    const paragraphs = reconstructParagraphs(pText);
    paragraphs.forEach((txt) => {
      pList.push({
        text: txt,
        pageIdx: pIdx
      });
    });
  }

  progress(`过滤提取出共有 ${pList.length} 个待排版翻译的有效文本块...`);

  // Translate with concurrency pool helper
  const pListWithIdx = pList.map((item, idx) => ({ originIdx: idx, text: item.text }));
  const translations = await batchTranslateWithConcurrency(pListWithIdx, translateFn, progress, customApi, "PDF段落");

  // Re-assemble translated pages
  const translatedPages: string[] = [];
  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageLines: string[] = [];
    pList.forEach((item, idx) => {
      if (item.pageIdx === pIdx) {
        pageLines.push(translations[idx]);
      }
    });

    if (pageLines.length === 0) {
      translatedPages.push('');
    } else {
      translatedPages.push(pageLines.join('\n\n'));
    }
  }
  
  const fullTranslatedContent = translatedPages.join('\n\n---\n\n');
  
  // Generating a beautiful, elegant PDF using pdf-lib (Helvetica standard PDF)
  progress(`构建双栏版面高保真对照 PDF 工作面...`);
  const pdfDoc = await PDFDocument.create();
  
  let baseFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let baseBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  let customFont: any = null;
  const targetLangLower = String(targetLang).toLowerCase();
  let fontUrl = '';
  if (targetLangLower.includes('zh') || targetLangLower.includes('cn')) {
    fontUrl = 'https://fonts.gstatic.com/s/zcoolxiaowei/v12/6N0b8dq8aP77n-VnK-m-v3Y9N18H.ttf';
  } else if (targetLangLower.includes('ja')) {
    fontUrl = 'https://fonts.gstatic.com/s/sawarobigothic/v15/N0bU2yp7F3V4yD4Z7q_b4gN8N0E.ttf';
  } else if (targetLangLower.includes('ko')) {
    fontUrl = 'https://fonts.gstatic.com/s/nanumpenscript/v23/34003z-OAdqO8Vp6_PFvO_18MD1A.ttf';
  }

  if (fontUrl) {
    progress(`正在加载语言专属字形排版包...`);
    try {
      let fontBuffer = pdfFontCache[fontUrl];
      if (!fontBuffer) {
        fontBuffer = await fetchFontWithTimeout(fontUrl, 4000);
        pdfFontCache[fontUrl] = fontBuffer;
      }
      customFont = await pdfDoc.embedFont(fontBuffer);
      progress(`字形排版包加载成功，已成功注入矢量绘图引擎。`);
    } catch (e: any) {
      console.warn(`[Font fetch failed] Fallback to system font:`, e.message);
    }
  }

  const font = customFont || baseFont;
  const boldFont = customFont || baseBoldFont;
  
  for (let pIdx = 0; pIdx < translatedPages.length; pIdx++) {
    const pageText = translatedPages[pIdx].trim();
    if (pageText.length === 0) continue;
    
    let pageObj = pdfDoc.addPage([595.276, 841.890]); // Standard A4 (595 x 841)
    const { width, height } = pageObj.getSize();
    
    // Header
    pageObj.drawText(`Document Translation File - Page ${pIdx + 1}`, {
      x: 50,
      y: height - 40,
      size: 8,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });

    // Check for East Asian/non-ASCII characters to print a clean warning banner ONCE per page
    const hasUnicode = /[^\x00-\x7F]/.test(pageText);
    if (hasUnicode && !customFont) {
      pageObj.drawText("Bilingual Workspace Alert", {
        x: 50,
        y: height - 52,
        size: 7,
        font: boldFont,
        color: rgb(0.9, 0.4, 0.1)
      });
      pageObj.drawText("Standard PDF readers do not embed localized system fonts. Download high-fidelity Word (.docx) on right panel for native vector font output.", {
        x: 130,
        y: height - 52,
        size: 6,
        font: font,
        color: rgb(0.4, 0.4, 0.4)
      });
    }
    
    const lines = pageText.split('\n');
    let yPos = height - 70;
    
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.length === 0) {
        yPos -= 10;
        continue;
      }
      
      const isHeader = line.length < 50 && (line.startsWith('#') || pIdx === 0);
      const fontSize = isHeader ? 12 : 8.5;
      const currentFont = isHeader ? boldFont : font;
      const leadingHeight = isHeader ? 15 : 11;
      
      const words = line.split(' ');
      let currentLine = '';
      
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        let textWidth = 0;
        try {
          textWidth = currentFont.widthOfTextAtSize(testLine, fontSize);
        } catch {
          // Fallback measurement if it contains unsupported characters
          textWidth = testLine.length * (fontSize * 0.45);
        }
        
        if (textWidth > width - 100) {
          if (yPos < 60) {
            pageObj = pdfDoc.addPage([595.276, 841.890]);
            yPos = height - 70;
          }
          try {
            pageObj.drawText(currentLine, { x: 50, y: yPos, size: fontSize, font: currentFont });
          } catch {
            // Clean non-ASCII for drawing placeholder gracefully
            const sanitized = currentLine.replace(/[^\x00-\x7F]/g, '?');
            try {
              pageObj.drawText(sanitized, { x: 50, y: yPos, size: fontSize, font: currentFont });
            } catch {
              pageObj.drawText("...", { x: 50, y: yPos, size: fontSize, font: font });
            }
          }
          yPos -= leadingHeight;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      
      if (currentLine) {
        if (yPos < 60) {
          pageObj = pdfDoc.addPage([595.276, 841.890]);
          yPos = height - 70;
        }
        try {
          pageObj.drawText(currentLine, { x: 50, y: yPos, size: fontSize, font: currentFont });
        } catch {
          const sanitized = currentLine.replace(/[^\x00-\x7F]/g, '?');
          try {
            pageObj.drawText(sanitized, { x: 50, y: yPos, size: fontSize, font: currentFont });
          } catch {
            pageObj.drawText("...", { x: 50, y: yPos, size: fontSize, font: font });
          }
        }
        yPos -= leadingHeight + 3;
      }
    }
  }
  
  const pdfBytes = await pdfDoc.save();
  
  return {
    docxBuffer: Buffer.from(fullTranslatedContent, 'utf8'),
    pdfBuffer: Buffer.from(pdfBytes),
    textContent: fullTranslatedContent
  };
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
}> = {};

app.post('/api/translate', upload.single('file'), async (req, res): Promise<any> => {
  const file = req.file;
  if (!file || file.size === 0 || !file.buffer || file.buffer.length === 0) {
    return res.status(400).json({ error: '上传的文件内容为空（大小为0字节）。若您是从历史记录中加载的，可能由于浏览器本地存储限制没能缓存原始文档，请点击重新拖入并上传您的本地原始文件再进行翻译。' });
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

  // Session state updates for progress bar reporting
  const updateProgress = (pct: number, statusText: string) => {
    activeSessions[sId] = { status: statusText, progress: pct };
    console.log(`[Session: ${sId}] ${pct}%: ${statusText}`);
  };
  
  updateProgress(10, `开始解析文档并初始化翻译引擎...`);

  // Execute in background
  Promise.resolve().then(async () => {
    try {
      const translateRunner = async (textBatch: string[]): Promise<string[]> => {
        return await translateTextBatch(textBatch, sourceLang, targetLang, tone, customApi);
      };

      let outputBuffer: Buffer | null = null;
      let outputName = '';
      let mimeType = 'application/octet-stream';
      let jsonPayload: any = null;

      if (ext === '.docx') {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        outputBuffer = await translateDocx(file.buffer, translateRunner, (msg) => updateProgress(20 + Math.random() * 60, msg), customApi);
        outputName = originalName.replace(/\.docx$/i, `_${targetLang}.docx`);
      } else if (ext === '.pptx') {
        mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        outputBuffer = await translatePptx(file.buffer, translateRunner, (msg) => updateProgress(20 + Math.random() * 60, msg), customApi);
        outputName = originalName.replace(/\.pptx$/i, `_${targetLang}.pptx`);
      } else if (ext === '.epub') {
        mimeType = 'application/epub+zip';
        outputBuffer = await translateEpub(file.buffer, translateRunner, (msg) => updateProgress(20 + Math.random() * 60, msg), customApi);
        outputName = originalName.replace(/\.epub$/i, `_${targetLang}.epub`);
      } else if (ext === '.md') {
        mimeType = 'text/markdown';
        outputBuffer = await translateMarkdown(file.buffer, translateRunner, (msg) => updateProgress(20 + Math.random() * 60, msg), customApi);
        outputName = originalName.replace(/\.md$/i, `_${targetLang}.md`);
      } else if (ext === '.pdf') {
        const pdfOut = await translatePdf(file.buffer, translateRunner, (msg) => updateProgress(20 + Math.random() * 60, msg), customApi, targetLang);
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
        translationCaches[sId] = { isJson: true, payload: jsonPayload };
      } else if (outputBuffer) {
        translationCaches[sId] = { isJson: false, buffer: outputBuffer, mimeType, outputName };
      }

      updateProgress(100, '翻译与排版完成！文档在缓存中准备下载...');
      if (activeSessions[sId]) activeSessions[sId].outputReady = true;

    } catch (err: any) {
      console.error(`Error during background translation handling:`, err);
      let errorMsg = err.message || 'Unknown translation error';
      if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('denied access')) {
        errorMsg = '【引擎访问限制 / 403 PERMISSION_DENIED】检测到内置公用 Gemini 接口受到开发沙盒网络/权限限制暂不可用。JoEbook 已为您集成本地/第三方大模型免密与配置机制：请点击页面右上角【设置 (齿轮) 按钮】，启用【第三方及自建模型】，切换使用您自己的 API 密钥 (我们为您预设了 Gemini 2.5 Official, DeepSeek, OpenAI, Ollama 快捷填表模板)，即可 100% 成功启动完美排版翻译！\n\n[Platform Info] Standard backend sandbox denied access (403). Please click the Settings icon in the top right, turn on the custom LLM integration toggle, and enter your own API Key using the Gemini 2.5 or DeepSeek/OpenAI autocomplete presets to enjoy high-speed layout-preserving document translation!';
      }
      activeSessions[sId] = { status: `出错: ${errorMsg}`, progress: -1, error: true };
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
  }

  else if (customApi && customApi.apiKey && customApi.baseUrl) {
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
    // Default Gemini API calling
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("内置 Gemini API Key 未配置。请通过 右上角设置 按钮启用您的“第三方及自建模型”配置自填 API Key。");
    }
    
    return await retryWithBackoff(async () => {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY!,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
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
  }
}

// Interactive: Translate arbitrary string list with API variables
app.post('/api/translate-chunks', async (req, res): Promise<any> => {
  const { texts, sourceLang, targetLang, tone, polishOnly, currentTranslation } = req.body;
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

  try {
    if (polishOnly) {
      const originalText = texts[0] || '';
      const polished = await polishTextSingle(originalText, currentTranslation || '', targetLang, tone, customApi);
      return res.json({ success: true, translations: [polished] });
    } else {
      const translations = await translateTextBatch(texts, sourceLang, targetLang, tone, customApi);
      return res.json({ success: true, translations });
    }
  } catch (err: any) {
    console.error('Error translating or polishing chunks:', err);
    let msg = err.message || '翻译段落组出错';
    if (msg.includes('Quota exceeded') || msg.includes('quota') || msg.includes('429_RESOURCE_EXHAUSTED') || msg.includes('429')) {
      msg = "【API 限流 / Quota Exceeded】内置公共 Gemini 大模型测试接口今日配额已用完导致 429 错误。JoEbook 极速排版引擎支持填入自备密钥：请点击页面右上角 ⚙ 设置 按钮，开启“第三方及自建模型”，切换为您本人的 API 密钥 (Gemini / DeepSeek / OpenAI 等) 首日无上限、零阻碍高速排版完成翻译！";
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
    const mainJsContent = `const { app, BrowserWindow, Menu } = require('electron');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "JoEbook",
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the web app URL. 
  const appURL = process.env.APP_URL || "${req.headers.referer || 'https://ais-dev-jtz4idduxc7va53lohaw7o-283544313319.us-west2.run.app'}";
  mainWindow.loadURL(appURL);

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

    // Add package.json
    const packageJsonContent = JSON.stringify({
      name: "joebook-mac-kit",
      version: "1.0.0",
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
    // Dist compiled folder structure
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JoEbook running locally on http://localhost:${PORT}`);
  });
};

startExpress();
