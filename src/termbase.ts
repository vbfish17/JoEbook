/**
 * JoEbook Termbase — 翻译术语记忆存储层
 * 
 * 基于 IndexedDB (idb-keyval) 的术语库 CRUD 操作。
 * 支持三个来源通道：手动录入、校对学习、外部导入。
 * 
 * 数据模型: TermEntry
 *   - id: 唯一标识
 *   - source: 原文术语
 *   - target: 译文术语
 *   - sourceLang: 源语言
 *   - targetLang: 目标语言
 *   - domain: 领域标签
 *   - frequency: 使用频次
 *   - confirmed: 是否经人工确认
 *   - createdAt / updatedAt: 时间戳
 */

import { get, set } from 'idb-keyval';

// ── Data Model ──────────────────────────────────────

export interface TermEntry {
  id: string;
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  domain: string;
  frequency: number;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TermbaseStats {
  total: number;
  confirmed: number;
  domains: string[];
  langPairs: string[];
}

// ── Storage Keys ─────────────────────────────────────

const TERMBASE_KEY = 'joebook-termbase';
const TERMBASE_VERSION_KEY = 'joebook-termbase-version';

// ── CRUD Operations ──────────────────────────────────

/** Load all term entries from IndexedDB */
export async function loadTermbase(): Promise<TermEntry[]> {
  try {
    const data = await get<TermEntry[]>(TERMBASE_KEY);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Save entire termbase to IndexedDB */
export async function saveTermbase(entries: TermEntry[]): Promise<void> {
  await set(TERMBASE_KEY, entries);
  await set(TERMBASE_VERSION_KEY, Date.now());
}

/** Add a single term entry */
export async function addTerm(entry: Omit<TermEntry, 'id' | 'frequency' | 'createdAt' | 'updatedAt'>): Promise<TermEntry> {
  const termbase = await loadTermbase();
  
  // Check for duplicate (same source+target+sourceLang+targetLang)
  const existing = termbase.find(
    t => t.source === entry.source 
      && t.target === entry.target 
      && t.sourceLang === entry.sourceLang 
      && t.targetLang === entry.targetLang
      && t.domain === entry.domain
  );
  
  if (existing) {
    // Increment frequency for existing entry
    existing.frequency += 1;
    existing.updatedAt = new Date().toISOString();
    if (entry.confirmed) existing.confirmed = true;
    await saveTermbase(termbase);
    return existing;
  }
  
  const newEntry: TermEntry = {
    ...entry,
    id: crypto.randomUUID(),
    frequency: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  termbase.push(newEntry);
  await saveTermbase(termbase);
  return newEntry;
}

/** Update an existing term entry by id */
export async function updateTerm(id: string, updates: Partial<Omit<TermEntry, 'id' | 'createdAt'>>): Promise<TermEntry | null> {
  const termbase = await loadTermbase();
  const idx = termbase.findIndex(t => t.id === id);
  if (idx === -1) return null;
  
  termbase[idx] = {
    ...termbase[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await saveTermbase(termbase);
  return termbase[idx];
}

/** Delete a term entry by id */
export async function deleteTerm(id: string): Promise<boolean> {
  const termbase = await loadTermbase();
  const filtered = termbase.filter(t => t.id !== id);
  if (filtered.length === termbase.length) return false;
  await saveTermbase(filtered);
  return true;
}

/** Delete multiple term entries by ids */
export async function deleteTerms(ids: string[]): Promise<number> {
  const termbase = await loadTermbase();
  const idSet = new Set(ids);
  const filtered = termbase.filter(t => !idSet.has(t.id));
  const deleted = termbase.length - filtered.length;
  await saveTermbase(filtered);
  return deleted;
}

/** Get terms filtered by language pair */
export async function getTermsByLangPair(sourceLang: string, targetLang: string): Promise<TermEntry[]> {
  const termbase = await loadTermbase();
  return termbase.filter(t => 
    t.sourceLang === sourceLang && t.targetLang === targetLang
  );
}

/** Get terms filtered by domain */
export async function getTermsByDomain(domain: string): Promise<TermEntry[]> {
  const termbase = await loadTermbase();
  return termbase.filter(t => t.domain === domain);
}

/** Get termbase statistics */
export async function getTermbaseStats(): Promise<TermbaseStats> {
  const termbase = await loadTermbase();
  const domains = [...new Set(termbase.map(t => t.domain).filter(Boolean))];
  const langPairs = [...new Set(termbase.map(t => `${t.sourceLang}→${t.targetLang}`))];
  return {
    total: termbase.length,
    confirmed: termbase.filter(t => t.confirmed).length,
    domains,
    langPairs,
  };
}

/** Export termbase as JSON string */
export async function exportTermbaseJSON(): Promise<string> {
  const termbase = await loadTermbase();
  return JSON.stringify(termbase, null, 2);
}

/** Export termbase as CSV string */
export async function exportTermbaseCSV(): Promise<string> {
  const termbase = await loadTermbase();
  const header = 'source,target,sourceLang,targetLang,domain,confirmed,frequency';
  const rows = termbase.map(t => 
    `"${t.source.replace(/"/g, '""')}","${t.target.replace(/"/g, '""')}","${t.sourceLang}","${t.targetLang}","${t.domain}","${t.confirmed}","${t.frequency}"`
  );
  return [header, ...rows].join('\n');
}

/** Import termbase from JSON string (merge with existing) */
export async function importTermbaseJSON(jsonStr: string, merge = true): Promise<{ imported: number; skipped: number }> {
  let entries: TermEntry[];
  try {
    entries = JSON.parse(jsonStr);
  } catch {
    throw new Error('Invalid JSON format');
  }
  
  if (!Array.isArray(entries)) {
    throw new Error('JSON must be an array of term entries');
  }
  
  const termbase = await loadTermbase();
  let imported = 0;
  let skipped = 0;
  
  for (const entry of entries) {
    if (!entry.source || !entry.target) {
      skipped++;
      continue;
    }
    
    // Check for duplicate
    const exists = termbase.some(t =>
      t.source === entry.source
        && t.target === entry.target
        && (t.sourceLang || '') === (entry.sourceLang || '')
        && (t.targetLang || '') === (entry.targetLang || '')
        && (t.domain || '') === (entry.domain || '')
    );
    
    if (exists && merge) {
      // Update frequency of existing entry
      const existing = termbase.find(t =>
        t.source === entry.source
          && t.target === entry.target
          && (t.sourceLang || '') === (entry.sourceLang || '')
          && (t.targetLang || '') === (entry.targetLang || '')
          && (t.domain || '') === (entry.domain || '')
      );
      if (existing) {
        existing.frequency += 1;
        if (entry.confirmed) existing.confirmed = true;
        existing.updatedAt = new Date().toISOString();
      }
      skipped++;
    } else if (!exists) {
      termbase.push({
        id: entry.id || crypto.randomUUID(),
        source: entry.source,
        target: entry.target,
        sourceLang: entry.sourceLang || 'en',
        targetLang: entry.targetLang || 'zh',
        domain: entry.domain || 'general',
        frequency: entry.frequency || 1,
        confirmed: entry.confirmed ?? false,
        createdAt: entry.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      imported++;
    } else {
      skipped++;
    }
  }
  
  await saveTermbase(termbase);
  return { imported, skipped };
}

/** Import termbase from CSV string (merge with existing) */
export async function importTermbaseCSV(csvStr: string): Promise<{ imported: number; skipped: number }> {
  const lines = csvStr.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have header + data rows');
  
  // Parse header
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const sourceIdx = header.indexOf('source');
  const targetIdx = header.indexOf('target');
  const sourceLangIdx = header.indexOf('sourceLang');
  const targetLangIdx = header.indexOf('targetLang');
  const domainIdx = header.indexOf('domain');
  const confirmedIdx = header.indexOf('confirmed');
  
  if (sourceIdx === -1 || targetIdx === -1) {
    throw new Error('CSV must have "source" and "target" columns');
  }
  
  const entries: Omit<TermEntry, 'id' | 'frequency' | 'createdAt' | 'updatedAt'>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= Math.max(sourceIdx, targetIdx)) continue;
    
    entries.push({
      source: cols[sourceIdx] || '',
      target: cols[targetIdx] || '',
      sourceLang: sourceLangIdx >= 0 ? cols[sourceLangIdx] || 'en' : 'en',
      targetLang: targetLangIdx >= 0 ? cols[targetLangIdx] || 'zh' : 'zh',
      domain: domainIdx >= 0 ? cols[domainIdx] || 'general' : 'general',
      confirmed: confirmedIdx >= 0 ? cols[confirmedIdx] === 'true' : false,
    });
  }
  
  let imported = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.source || !entry.target) {
      skipped++;
      continue;
    }
    try {
      await addTerm(entry);
      imported++;
    } catch {
      skipped++;
    }
  }
  
  return { imported, skipped };
}

/** Generate glossary prompt injection string for translateTextBatch */
export async function buildGlossaryPrompt(sourceLang: string, targetLang: string, limit = 80): Promise<string> {
  const terms = await getTermsByLangPair(sourceLang, targetLang);
  
  if (terms.length === 0) return '';
  
  // Sort by frequency (most used first), then by confirmed status
  const sorted = terms
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
      return b.frequency - a.frequency;
    })
    .slice(0, limit);
  
  const glossaryObj: Record<string, string> = {};
  for (const t of sorted) {
    glossaryObj[t.source] = t.target;
  }
  
  return `\n6. When translating, you MUST use the following terminology mapping:\n${JSON.stringify(glossaryObj, null, 2)}\nIf a source term from the mapping appears in the text, use its corresponding target term exactly as specified. This overrides any default translation choice.\n`;
}

/** Build glossary JSON for Python scripts (pdf_translate_workflow.py --glossary-json) */
export async function buildGlossaryJSON(sourceLang: string, targetLang: string): Promise<string> {
  const terms = await getTermsByLangPair(sourceLang, targetLang);
  const glossary: Record<string, string> = {};
  
  // Sort by source length (longer first for priority matching)
  const sorted = terms
    .sort((a, b) => b.source.length - a.source.length);
  
  for (const t of sorted) {
    glossary[t.source] = t.target;
  }
  
  return JSON.stringify(glossary, null, 2);
}

// ── Diff Learning Utilities ──────────────────────────

/** Candidate term pair extracted from a manual edit */
export interface TermCandidate {
  source: string;   // source language fragment
  target: string;   // corrected target fragment
  oldTarget: string; // original (pre-edit) target fragment
  confidence: number; // 0-1 confidence score
}

export interface TermImportDefaults {
  sourceLang?: string;
  targetLang?: string;
  domain?: string;
  confirmed?: boolean;
}

export function normalizeTermText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function parseTermComparisonText(text: string, defaults: TermImportDefaults = {}): Omit<TermEntry, 'id' | 'frequency' | 'createdAt' | 'updatedAt'>[] {
  const sourceLang = defaults.sourceLang || 'en';
  const targetLang = defaults.targetLang || 'zh';
  const domain = defaults.domain || 'general';
  const confirmed = defaults.confirmed ?? true;
  const rows: Omit<TermEntry, 'id' | 'frequency' | 'createdAt' | 'updatedAt'>[] = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    let parts: string[];
    if (line.includes('=>')) {
      parts = line.split(/=>/);
    } else if (line.includes('→')) {
      parts = line.split(/→/);
    } else if (line.includes('\t')) {
      parts = line.split(/\t/);
    } else {
      parts = parseCSVLine(line);
    }

    if (parts.length < 2) continue;
    const source = normalizeTermText(parts[0]);
    const target = normalizeTermText(parts.slice(1).join(','));
    if (!source || !target || source === target) continue;

    rows.push({ source, target, sourceLang, targetLang, domain, confirmed });
  }

  return rows;
}

export async function importTermComparisonText(text: string, defaults: TermImportDefaults = {}): Promise<{ imported: number; skipped: number }> {
  const entries = parseTermComparisonText(text, defaults);
  let imported = 0;
  let skipped = 0;
  for (const entry of entries) {
    try {
      await addTerm(entry);
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
}

export function applyTerminologyToText(text: string, terms: Pick<TermEntry, 'source' | 'target'>[]): string {
  let output = String(text || '');
  const sorted = [...terms]
    .filter(t => t.source && t.target)
    .sort((a, b) => b.source.length - a.source.length);
  for (const term of sorted) {
    output = output.split(term.source).join(term.target);
  }
  return output;
}

/**
 * Extract term candidates from a before/after text diff.
 * Simple approach: find changed substrings and match to source.
 */
export function extractTermCandidates(
  originalSource: string,
  oldTranslation: string,
  newTranslation: string
): TermCandidate[] {
  if (oldTranslation === newTranslation) return [];
  
  const candidates: TermCandidate[] = [];
  
  // Find differing segments by simple sliding comparison
  const oldWords = oldTranslation.split(/(\s+)/);
  const newWords = newTranslation.split(/(\s+)/);
  
  // Strategy 1: If only a single contiguous segment changed, treat it as a term candidate
  let changeStart = -1;
  let changeEnd = -1;
  
  for (let i = 0; i < Math.max(oldWords.length, newWords.length); i++) {
    if (oldWords[i] !== newWords[i]) {
      if (changeStart === -1) changeStart = i;
      changeEnd = i;
    }
  }
  
  if (changeStart !== -1 && changeStart === changeEnd) {
    // Single word/segment changed — high confidence
    const oldSegment = oldWords.slice(changeStart, changeEnd + 1).join('').trim();
    const newSegment = newWords.slice(changeStart, changeEnd + 1).join('').trim();
    
    if (oldSegment && newSegment && oldSegment !== newSegment) {
      // Try to find the corresponding source fragment
      const sourceFragment = findCorrespondingSource(originalSource, oldSegment, newSegment);
      candidates.push({
        source: sourceFragment,
        target: newSegment,
        oldTarget: oldSegment,
        confidence: sourceFragment ? 0.85 : 0.5,
      });
    }
  } else if (changeStart !== -1) {
    // Multiple segments changed — lower confidence, try heuristic
    const oldSegment = oldWords.slice(changeStart, changeEnd + 1).join('').trim();
    const newSegment = newWords.slice(changeStart, changeEnd + 1).join('').trim();
    
    if (oldSegment && newSegment && oldSegment !== newSegment) {
      const sourceFragment = findCorrespondingSource(originalSource, oldSegment, newSegment);
      candidates.push({
        source: sourceFragment || originalSource.substring(0, 50),
        target: newSegment,
        oldTarget: oldSegment,
        confidence: sourceFragment ? 0.6 : 0.3,
      });
    }
  }
  
  // Strategy 2: Full text replacement (single paragraph edit)
  if (candidates.length === 0 && oldTranslation.trim() !== newTranslation.trim()) {
    // If the edit looks like a term-level correction (short change)
    const diffLen = Math.abs(oldTranslation.length - newTranslation.length);
    const maxLen = Math.max(oldTranslation.length, newTranslation.length);
    
    if (maxLen > 0 && diffLen / maxLen < 0.5) {
      // Less than 50% changed — likely a term-level fix
      candidates.push({
        source: originalSource.substring(0, 80),
        target: newTranslation,
        oldTarget: oldTranslation,
        confidence: 0.2,
      });
    }
  }
  
  if (candidates.length > 0) {
    return candidates.map(c => ({
      ...c,
      source: normalizeTermText(c.source),
      target: trimSentenceTail(normalizeTermText(c.target)),
      oldTarget: trimSentenceTail(normalizeTermText(c.oldTarget)),
    })).filter(c => c.source && c.target && c.oldTarget !== c.target);
  }

  return candidates;
}

function trimSentenceTail(text: string): string {
  const trimmed = text.trim();
  return trimmed
    .replace(/[。.!！?？；;，,、].*$/, '')
    .replace(/(很重要|重要|is important|important)$/i, '')
    .trim() || trimmed;
}

/**
 * Heuristic: find the source fragment that corresponds to a translation change.
 * Uses simple substring matching and position proximity.
 */
function findCorrespondingSource(sourceText: string, oldTarget: string, newTarget: string): string {
  // If the old target appears verbatim in source (e.g. untranslated term), use it
  if (sourceText.includes(oldTarget)) {
    return oldTarget;
  }
  
  // If the source is short enough, just use the whole source
  if (sourceText.split(/\s+/).length <= 5) {
    return sourceText;
  }
  
  // Try matching by word overlap
  const newWords = new Set(newTarget.toLowerCase().split(/\s+/));
  const sourceWords = sourceText.split(/\s+/);
  
  let bestMatch = '';
  let bestOverlap = 0;
  
  for (let windowSize = 1; windowSize <= Math.min(6, sourceWords.length); windowSize++) {
    for (let i = 0; i <= sourceWords.length - windowSize; i++) {
      const window = sourceWords.slice(i, i + windowSize);
      const windowLower = new Set(window.map(w => w.toLowerCase()));
      const overlap = [...windowLower].filter(w => newWords.has(w)).length;
      
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = window.join(' ');
      }
    }
  }
  
  return bestOverlap > 0 ? bestMatch : '';
}

// ── CSV Parsing Helper ───────────────────────────────

/** Parse a single CSV line respecting quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
