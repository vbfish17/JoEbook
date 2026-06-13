import React, { useState, useEffect, useRef } from 'react';
import { get, set } from 'idb-keyval';
import { motion, AnimatePresence } from 'motion/react';
import {
  addTerm,
  addTerms,
  deleteTerm,
  loadTermbase,
  seedDefaultTermbase,
  updateTerm,
  extractTermCandidates,
  parseTermComparisonText,
  type TermEntry,
  type NewTermEntry,
} from './termbase';
import { planAgentAllocation, type RoleApiMap } from './agentOrchestrator';
import { 
  UploadCloud, 
  Languages, 
  FileText, 
  CheckCircle, 
  Settings2, 
  Loader2, 
  Download, 
  AlertCircle, 
  AlertTriangle,
  Trash2, 
  BookOpen, 
  Plus, 
  Sparkles, 
  Cpu, 
  HelpCircle,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Info,
  RefreshCw,
  Globe,
  Terminal,
  Search,
  Check,
  Edit,
  Cpu as CpuIcon,
  Sliders,
  Eye,
  Save,
  FolderOpen
} from 'lucide-react';

interface CustomApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ModelProfile extends CustomApiConfig {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

type AgentRole = 'planner' | 'executor' | 'proofreader';

interface TranslationHistoryItem {
  id: string;
  name: string;
  size: string;
  sourceLang: string;
  targetLang: string;
  timestamp: string;
  format: string;
  downloadUrl?: string;
  pdfBase64?: string;
  docxBase64?: string;
  textContent?: string;
  fileBase64?: string;
}

interface ResultPayload {
  docxBase64?: string;
  pdfBase64?: string;
  textContent?: string;
  outputName?: string;
  docxName?: string;
  directDownloadBlob?: Blob;
  directDownloadName?: string;
}

interface WorkspaceResultItem {
  id: string;
  sourceFileName: string;
  format: string;
  targetLang: string;
  result: ResultPayload;
}

interface LlmPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  hasCustomKey: boolean;
  requiredKeyPlaceholder: string;
  descriptionZh: string;
  descriptionEn: string;
}

const llmPresets: LlmPreset[] = [
  {
    id: 'gemini',
    name: 'Gemini (Google Official)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    hasCustomKey: true,
    requiredKeyPlaceholder: 'AIzaSy...',
    descriptionZh: 'Google 官方 API (兼容 OpenAI 格式)',
    descriptionEn: 'Official Google API (OpenAI compatible endpoint)'
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT Engine)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    hasCustomKey: true,
    requiredKeyPlaceholder: 'sk-...',
    descriptionZh: '官方 OpenAI ChatGPT 模型中继',
    descriptionEn: 'Official OpenAI GPT LLM series'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    hasCustomKey: true,
    requiredKeyPlaceholder: 'sk-...',
    descriptionZh: '高性价比满血版 DeepSeek 官方通道',
    descriptionEn: 'High-performance DeepSeek-V3/R1 model portal'
  },
  {
    id: 'qwen',
    name: 'Qwen (阿里通义)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    hasCustomKey: true,
    requiredKeyPlaceholder: 'sk-...',
    descriptionZh: '阿里通义千问大模型兼容模式',
    descriptionEn: 'Alibaba Qwen model series compatible api'
  },
  {
    id: 'ollama',
    name: 'Ollama (Local Deploy)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    hasCustomKey: false,
    requiredKeyPlaceholder: '无需密钥 (Optional)',
    descriptionZh: '本地自部署 Ollama 模型引擎',
    descriptionEn: 'Offline local Ollama intelligence (Free)'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'mlx-community/translategemma-4b-it-4bit_immersive-translate',
    hasCustomKey: false,
    requiredKeyPlaceholder: '无需密钥 (Optional)',
    descriptionZh: '本地 LM Studio 图形化加载通道，优先适配 TranslateGemma 翻译模型',
    descriptionEn: 'Local GGUF / MLX translation models in LM Studio, optimized for TranslateGemma'
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI Compatible)',
    baseUrl: '',
    defaultModel: '',
    hasCustomKey: true,
    requiredKeyPlaceholder: '密钥 (Key)',
    descriptionZh: '输入任意兼容 OpenAI 规范的中端中转站',
    descriptionEn: 'Enter any customized OpenAI compliant gateway'
  }
];

// Complete Bilingual Dictionary Mapping
const translations = {
  zh: {
    title: "JoEbook",
    version: "v2.0.0",
    subTitle: "保留版式的本地文档智能翻译工具 (Bento Grid)",
    tagline: "全格式 (PDF, Word, PPTX, EPUB, MD) 本地无损翻译与排版对齐重建",

    customApiTitle: "模型管理中心",
    customApiToggle: "启用第三方/本地运行 LLM 接口 (Ollama, DeepSeek 等)",
    modelSettings: "模型自定义参数与鉴权",
    apiKey: "API 密钥 (API Key)",
    baseUrl: "API 基础路径 (Base URL)",
    modelName: "匹配模型名称 (Model)",
    dragTitle: "拖拽或点击导入本地排版文档",
    dragSub: "支持高精解构格式：PDF, DOCX, PPTX, EPUB 及高级 Markdown (.md)",
    sourceFile: "导入的源文档",
    formatNotice: "格式保留解析",
    chooseLang: "目标语言与翻译表达风格",
    sourceLangLabel: "源文档原文语言 (Source)",
    targetLangLabel: "翻译译文目标语言 (Target)",
    toneLabel: "翻译语气表达风格 (Tone)",
    toneProfessional: "严谨专业学术风格 (Research & Academic)",
    toneProfessionalDesc: "适合学术论文、说明书与技术白皮书",
    toneCasual: "通俗易懂地道日常 (Idiomatic Standard)",
    toneCasualDesc: "流畅自然，非常适合电子书、故事与随笔",
    toneTechnical: "逐字高精专词对齐 (Direct Term Gloss)",
    toneTechnicalDesc: "维持原始术语直译风格，极力避免修饰词",
    workspaceTitle: "智能翻译排版进度视窗 / Workspace",
    waiting: "等待导入文件任务",
    waitingDesc: "在上侧卡片中投入需要翻新保留排版的文件，选定模型风格，在这里即可流畅追踪底阶 ZIP 元数据及 XML 的句对解构进度。",
    interpreting: "正在执行元文件超高精度解构...",
    interpretingDesc: "正在解构并提取 ZIP 底阶图层，保障文字、样式、数学公式与单元格尺寸的平移对齐。",
    completedTitle: "版面与翻译全部完美封装对齐完成！",
    completedSub: "已成功重建并提供双出口对齐封装格式",
    pdfReport: "精美保留版式 PDF 译本",
    bilingualText: "中外双对照对齐文本.txt",
    downloadBtn: "立即下载保存该文档",
    bilingualPreview: "生成双语对齐段落预览",
    unsupportedFile: "不支持的格式。请选择 docx, pptx, epub, md 或 pdf 文件。",
    historyTitle: "本地翻译运行日志 / Cache Logs",
    clearHistory: "清空历史缓存",
    noHistory: "暂无历史记录。已译文件将缓存于下方以便快速调用。",
    footerText: "JoEbook © 2026. 保留版式翻译与双语校对工作台。",
    documentation: "格式保留原理",
    howItWorksText: "对于 Office 及 Epub 文件，系统利用 ZIP 归档将底层 XML/HTML 段落提取出，翻译后重写写入原格式元位置，确保原有配图、大卡幻灯片和公式完全不受任何损毁。",
    macTitle: "macOS (Apple Silicon M系列) DMG 桌面端打包构建套件",
    macDesc: "想要一键让 JoEbook 成为 macOS 原生软件吗？本工具包专门为 Apple 硅芯片（M1-M4 系列）进行了桌面级架构调整，只需一步运行即可生成打包 dmg 包。",
    macDownloadBtn: "获取 M系列客户端打包源码包 (ZIP)",
    macCommandTitle: "Mac 本地编译运行指令:",
    macStep1: "1. 双击解压下载得到的安装开发包 joebook-mac-kit.zip",
    macStep2: "2. 在 Mac 终端运行单步编译，即可输出 arm64 原生 dmg 文件:",
    presetSection: "主流 LLM API 快捷预设模板 Click-Fill ⚡",
    presetInfo: "点击模板将自动填写对应的 Base URL 和标准 Model!",
    selectPresetBtn: "选择该预设",
    currentLangIndicator: "当前语言",
    saveLocation: "文件保存位置",
    saveLocationSource: "源文件所在目录 (默认)",
    saveLocationCustom: "自定义目录路径",
    saveLocationPlaceholder: "例如: /Users/myname/Downloads/Translated",
    saveLocationNote: "",
  },
  en: {
    title: "JoEbook",
    version: "v2.0.0",
    subTitle: "Structure-Preserving Intelligent Document Translator (Bento Grid)",
    tagline: "Lossless layout-aligned translation for PDF, DOCX, PPTX, EPUB, and Markdown",

    customApiTitle: "Model Management Center",
    customApiToggle: "Enable Third-party / Local LLM Integration (Ollama, DeepSeek)",
    modelSettings: "Model Configuration & Credentials",
    apiKey: "API Key",
    baseUrl: "API Base URL",
    modelName: "Model Name",
    dragTitle: "Drag & drop or Click to Import Local Document",
    dragSub: "Supports precise layouts: PDF, DOCX, PPTX, EPUB, and Markdown (.md)",
    sourceFile: "Imported Document",
    formatNotice: "Layout Reconstruction Mode",
    chooseLang: "Target Language & Tone Optimizers",
    sourceLangLabel: "Source Document Language",
    targetLangLabel: "Target Translation Language",
    toneLabel: "Translation Expression Tone",
    toneProfessional: "Professional Academic & Editorial",
    toneProfessionalDesc: "Ideal for research articles, manuals, and papers",
    toneCasual: "Idiomatic daily conversation style",
    toneCasualDesc: "Natural flow, perfect for novels, daily articles, and tutorials",
    toneTechnical: "Literal term-to-term accuracy",
    toneTechnicalDesc: "Maintains raw terminology directly, preventing excessive translation override",
    workspaceTitle: "Translation Layout Workspace",
    waiting: "Awaiting Document Tasks",
    waitingDesc: "Upload your styled document above and choose your model settings. Program process, low-level ZIP nodes and sentence reconstruction will update live here.",
    interpreting: "Deconstructing file layers...",
    interpretingDesc: "Segmenting raw ZIP markup layer trees to lock table coordinates, headings, font variables and layouts securely.",
    completedTitle: "Layout Refinement & Symmetrical Packaging Complete!",
    completedSub: "Exportable layout-aligned packages constructed cleanly",
    pdfReport: "Refined Style PDF Translation",
    bilingualText: "Symmetrical Bilingual Alignment Text.txt",
    downloadBtn: "Download Translated Document",
    bilingualPreview: "Bilingual Sentence Preview",
    unsupportedFile: "Unsupported format. Please select a docx, pptx, epub, md or pdf catalog.",
    historyTitle: "Bilingual Operations Local Logs",
    clearHistory: "Flush Local Caches",
    noHistory: "No cached records found. Export history registers below for rapid retrieval.",
    footerText: "JoEbook © 2026. Structure-preserving translation and bilingual review workspace.",
    documentation: "Integrity Restoration Doctrine",
    howItWorksText: "For digital documents, our core parser unzips raw assets, replaces raw XML content nodes concurrently with target text segments, and repacks without touching layout spacing or pictures.",
    macTitle: "macOS (Apple Silicon M-Series) Native DMG Compiling Suite",
    macDesc: "Turn JoEbook into a native desktop utility! Specifically configured for high-efficiency Apple Silicon (M1-M4 series), run compiling on any Mac machine to obtain an ARM64 app bundle.",
    macDownloadBtn: "Download DMG Packaging Kit (ZIP Source)",
    macCommandTitle: "Compile terminal steps on your local Mac:",
    macStep1: "1. Double-click to expand downloaded joebook-mac-kit.zip source code package",
    macStep2: "2. Open MacOS Terminal and execute single building command to output Apple Silicon dmg executable:",
    presetSection: "Major LLM API Template Autocomplete ⚡",
    presetInfo: "Click any templated endpoint to instantly configure API Base URL and matching model variables!",
    selectPresetBtn: "Apply Template",
    currentLangIndicator: "Current OS Language",
    saveLocation: "File Save Location",
    saveLocationSource: "Source File Directory (Default)",
    saveLocationCustom: "Custom Directory Path",
    saveLocationPlaceholder: "e.g., /Users/myname/Downloads/Translated",
    saveLocationNote: "",
  }
};

const ITEMS_PER_PAGE = 5;

export default function App() {
  // Locale State (Default system language fallback)
  const [currentLang, setCurrentLang] = useState<'zh' | 'en'>(() => {
    try {
      const savedLang = localStorage.getItem('trans_ui_language');
      if (savedLang === 'zh' || savedLang === 'en') return savedLang;
      // System language check
      const system = (navigator.language || 'zh').toLowerCase();
      return system.includes('zh') ? 'zh' : 'en';
    } catch {
      return 'zh';
    }
  });

  const t = translations[currentLang];

  // Language selectors
  const sourceLanguages = [
    'Auto', 'Chinese', 'English', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Russian', 'Italian', 'Portuguese', 'Arabic'
  ];

  const targetLanguages = [
    { name: 'Chinese (Simplified)', labelZh: '中文 (简体)', labelEn: 'Chinese (Simplified)' },
    { name: 'Chinese (Traditional)', labelZh: '中文 (繁体)', labelEn: 'Chinese (Traditional)' },
    { name: 'English', labelZh: '英语 (English)', labelEn: 'English' },
    { name: 'Japanese', labelZh: '日语 (Japanese)', labelEn: 'Japanese' },
    { name: 'Korean', labelZh: '韩语 (Korean)', labelEn: 'Korean' },
    { name: 'Spanish', labelZh: '西班牙语 (Spanish)', labelEn: 'Spanish' },
    { name: 'French', labelZh: '法语 (French)', labelEn: 'French' },
    { name: 'German', labelZh: '德语 (German)', labelEn: 'German' },
    { name: 'Russian', labelZh: '俄语 (Russian)', labelEn: 'Russian' },
    { name: 'Italian', labelZh: '意大利语 (Italian)', labelEn: 'Italian' },
    { name: 'Portuguese', labelZh: '葡萄牙语 (Portuguese)', labelEn: 'Portuguese' },
    { name: 'Arabic', labelZh: '阿拉伯语 (Arabic)', labelEn: 'Arabic' }
  ];

  // General State
  const [files, setFiles] = useState<File[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const file = files[activeIndex] || null;
  const setFile = (newFile: File | null) => {
    if (newFile === null) {
      setFiles([]);
      setActiveIndex(0);
    } else {
      setFiles([newFile]);
      setActiveIndex(0);
    }
  };
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchCurrentIndex, setBatchCurrentIndex] = useState<number>(0);
  const [nextBatchIdxToStart, setNextBatchIdxToStart] = useState<number | null>(null);
  const batchResolveRef = useRef<((value: boolean) => void) | null>(null);

  // Unified translation state reset
  const resetTranslationState = () => {
    setIsTranslating(false);
    setIsBatchProcessing(false);
    setProgressPercent(0);
    setStagesMessage('');
    setBatchCurrentIndex(0);
    setNextBatchIdxToStart(null);
    clearInterval(progressPollingRef.current);
  };
  const [sourceLang, setSourceLang] = useState<string>('Auto');
  const [targetLang, setTargetLang] = useState<string>('Chinese (Simplified)');
  const [tone, setTone] = useState<string>('professional');
  
  // Custom LLM Settings State
  const [useCustomApi, setUseCustomApi] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('trans_use_custom_api');
      return saved === 'true';
    } catch (_) {
      return false;
    }
  });
  const [selectedPreset, setSelectedPreset] = useState<string>(() => {
    try {
      return localStorage.getItem('trans_selected_preset') || 'custom';
    } catch (_) {
      return 'custom';
    }
  });
  const [customApi, setCustomApi] = useState<CustomApiConfig>(() => {
    try {
      const activePreset = localStorage.getItem('trans_selected_preset') || 'custom';
      const savedPresetsStr = localStorage.getItem('trans_preset_configs_v3');
      if (savedPresetsStr) {
        const presets = JSON.parse(savedPresetsStr);
        if (presets && presets[activePreset]) {
          return presets[activePreset];
        }
      }
      const saved = localStorage.getItem('trans_custom_api_config');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (_) {}
    return {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    };
  });
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelsFetchError, setModelsFetchError] = useState<string>('');
  const [showSettings, setShowSettings] = useState<boolean>(true);
  const [settingsSavedBadge, setSettingsSavedBadge] = useState<boolean>(false);
  const [saveMode, setSaveMode] = useState<'source' | 'custom'>(() => {
    try {
      const saved = localStorage.getItem('trans_save_mode');
      return saved === 'custom' ? 'custom' : 'source';
    } catch { return 'source'; }
  });
  const [customSavePath, setCustomSavePath] = useState<string>(() => {
    try {
      return localStorage.getItem('trans_custom_save_path') || '';
    } catch { return ''; }
  });
  // DMG detection: has Electron file system API
  const isDMG = typeof window !== 'undefined' && !!(window as any).electronAPI?.setSavePath;
  const [draftRestoredNotification, setDraftRestoredNotification] = useState<string | null>(null);
  const [draftSavedBadge, setDraftSavedBadge] = useState<boolean>(false);
  const [showApiFields, setShowApiFields] = useState<boolean>(true);
  const [presetConfigs, setPresetConfigs] = useState<Record<string, CustomApiConfig>>(() => {
    try {
      const saved = localStorage.getItem('trans_preset_configs_v3');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (_) {}
    return {
      gemini: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
      openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      qwen: { apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      ollama: { apiKey: 'not-required', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
      lmstudio: { apiKey: 'not-required', baseUrl: 'http://localhost:1234/v1', model: 'mlx-community/translategemma-4b-it-4bit_immersive-translate' },
      custom: { apiKey: '', baseUrl: '', model: '' }
    };
  });

  // Translation Progression State
  const [sessionId, setSessionId] = useState<string>('');
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [stagesMessage, setStagesMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [translationFinished, setTranslationFinished] = useState<boolean>(false);

  // Source directory path (extracted from File.path when adding files via <input>)
  const [sourceDirPath, setSourceDirPath] = useState<string>('');

  // Interactive Proofreading State
  const [isInteractiveMode, setIsInteractiveMode] = useState<boolean>(false);
  const [interactiveStep, setInteractiveStep] = useState<'idle' | 'parsing' | 'translating' | 'editing'>('idle');
  const [originalParagraphs, setOriginalParagraphs] = useState<string[]>([]);
  const [translatedParagraphs, setTranslatedParagraphs] = useState<string[]>([]);
  const [blockStatuses, setBlockStatuses] = useState<string[]>([]);

  // Refs to avoid stale closures in progressive translations async loops
  const translatedParagraphsRef = useRef<string[]>([]);
  const blockStatusesRef = useRef<string[]>([]);

  useEffect(() => {
    translatedParagraphsRef.current = translatedParagraphs;
  }, [translatedParagraphs]);

  useEffect(() => {
    blockStatusesRef.current = blockStatuses;
  }, [blockStatuses]);

  useEffect(() => {
    if (nextBatchIdxToStart !== null && isBatchProcessing) {
      const idx = nextBatchIdxToStart;
      const timer = setTimeout(() => {
        const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
        handleTranslate(fakeEvent);
        setNextBatchIdxToStart(null);
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [nextBatchIdxToStart, isBatchProcessing]);
  const [activeInteractivePage, setActiveInteractivePage] = useState<number>(0);
  const [interactiveSearch, setInteractiveSearch] = useState<string>('');
  const [interactiveFileMeta, setInteractiveFileMeta] = useState<{ name: string; type: string; totalBlocks: number }>({ name: '', type: '', totalBlocks: 0 });
  const [isRepacking, setIsRepacking] = useState<boolean>(false);
  const [confirmExit, setConfirmExit] = useState<boolean>(false);
  const [showRepackConfirm, setShowRepackConfirm] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>(() => {
    try {
      const saved = localStorage.getItem('joebook-model-profiles');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  });
  const [defaultModelProfileId, setDefaultModelProfileId] = useState<string>(() => localStorage.getItem('joebook-default-model-profile-id') || '');
  const [profileNotice, setProfileNotice] = useState<string>('');
  const [termbaseEntries, setTermbaseEntries] = useState<TermEntry[]>([]);
  const [termComparisonText, setTermComparisonText] = useState<string>('');
  const [termbaseNotice, setTermbaseNotice] = useState<string>('');
  const [showTermbaseLibrary, setShowTermbaseLibrary] = useState<boolean>(() => localStorage.getItem('joebook_show_termbase') !== 'false');
  const [termSearch, setTermSearch] = useState<string>('');
  const [editingTermId, setEditingTermId] = useState<string>('');
  const [termbaseEnabled, setTermbaseEnabled] = useState<boolean>(() => localStorage.getItem('joebook_termbase_enabled') !== 'false');
  const [agentOrchestrationEnabled, setAgentOrchestrationEnabled] = useState<boolean>(() => localStorage.getItem('joebook_agent_orchestration') === 'true');
  const [agentMaxExecutors, setAgentMaxExecutors] = useState<number>(() => Number(localStorage.getItem('joebook_agent_max_executors') || '4'));
  const [agentRoleProfileIds, setAgentRoleProfileIds] = useState<Record<AgentRole, string>>(() => {
    try {
      const saved = localStorage.getItem('joebook-agent-role-config');
      if (saved) return { planner: '', executor: '', proofreader: '', ...JSON.parse(saved) };
    } catch (_) {}
    return { planner: '', executor: '', proofreader: '' };
  });
  const [agentStatus, setAgentStatus] = useState<string>('');

  // JoEbook editor utilities: find and replace across the bilingual workspace
  const [findQuery, setFindQuery] = useState<string>('');
  const [replaceQuery, setReplaceQuery] = useState<string>('');
  const [workspaceSubView, setWorkspaceSubView] = useState<'editor' | 'preview'>('editor');
  const [polishBlockIdx, setPolishBlockIdx] = useState<number | null>(null);
  const [isPolishing, setIsPolishing] = useState<boolean>(false);

  // Result Cache
  const [translatingPriorityIds, setTranslatingPriorityIds] = useState<number[]>([]);
  const [resultPayload, setResultPayload] = useState<ResultPayload | null>(null);
  const [workspaceResults, setWorkspaceResults] = useState<WorkspaceResultItem[]>([]);

  // History State
  const [history, setHistory] = useState<TranslationHistoryItem[]>([]);

  // Drag and Drop State
  const [dragActive, setDragActive] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressPollingRef = useRef<any>(null);
  const isDownloadingRef = useRef<boolean>(false);

  // Load history from IndexedDB
  useEffect(() => {
    get('document_translation_history')
      .then((saved) => {
        if (saved && Array.isArray(saved) && saved.length > 0) {
          setHistory(saved);
        } else {
          // Fallback migration from localStorage
          const oldSavedStr = localStorage.getItem('document_translation_history');
          if (oldSavedStr) {
            try {
              const oldSaved = JSON.parse(oldSavedStr);
              if (Array.isArray(oldSaved) && oldSaved.length > 0) {
                setHistory(oldSaved);
                set('document_translation_history', oldSaved).catch(() => {});
              }
            } catch (err) {}
          }
        }
      })
      .catch((e) => {
        console.error("Failed to load translation history", e);
      });
  }, []);

  // Save history to IndexedDB
  const saveHistory = (updatedOrUpdater: TranslationHistoryItem[] | ((prev: TranslationHistoryItem[]) => TranslationHistoryItem[])) => {
    setHistory((prev) => {
      const next = typeof updatedOrUpdater === 'function' ? updatedOrUpdater(prev) : updatedOrUpdater;
      set('document_translation_history', next).catch((e) => {
        console.error("Failed to store translation history", e);
      });
      return next;
    });
  };

  useEffect(() => {
    loadTermbase().then(setTermbaseEntries).catch(() => setTermbaseEntries([]));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('joebook-model-profiles', JSON.stringify(modelProfiles));
      localStorage.setItem('joebook-default-model-profile-id', defaultModelProfileId);
      localStorage.setItem('joebook-agent-role-config', JSON.stringify(agentRoleProfileIds));
      localStorage.setItem('joebook_show_termbase', String(showTermbaseLibrary));
      localStorage.setItem('joebook_termbase_enabled', String(termbaseEnabled));
    } catch (_) {}
  }, [modelProfiles, defaultModelProfileId, agentRoleProfileIds, showTermbaseLibrary, termbaseEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('joebook_agent_orchestration', String(agentOrchestrationEnabled));
      localStorage.setItem('joebook_agent_max_executors', String(agentMaxExecutors));
    } catch (_) {}
  }, [agentOrchestrationEnabled, agentMaxExecutors]);

  // Auto-save Settings to localStorage when values change
  useEffect(() => {
    try {
      localStorage.setItem('trans_use_custom_api', String(useCustomApi));
      localStorage.setItem('trans_selected_preset', selectedPreset);
      localStorage.setItem('trans_custom_api_config', JSON.stringify(customApi));
      localStorage.setItem('trans_preset_configs_v3', JSON.stringify(presetConfigs));
    } catch (_) {}
  }, [useCustomApi, selectedPreset, customApi, presetConfigs]);

  // Auto-save location settings
  useEffect(() => {
    try {
      localStorage.setItem('trans_save_mode', saveMode);
      localStorage.setItem('trans_custom_save_path', customSavePath);
    } catch (_) {}
  }, [saveMode, customSavePath]);

  // Save Settings manual function
  const saveSettingsLocally = () => {
    try {
      localStorage.setItem('trans_use_custom_api', String(useCustomApi));
      localStorage.setItem('trans_selected_preset', selectedPreset);
      localStorage.setItem('trans_custom_api_config', JSON.stringify(customApi));
      localStorage.setItem('trans_preset_configs_v3', JSON.stringify(presetConfigs));
      localStorage.setItem('trans_save_mode', saveMode);
      localStorage.setItem('trans_custom_save_path', customSavePath);
      setSettingsSavedBadge(true);
      setTimeout(() => {
        setSettingsSavedBadge(false);
      }, 2500);
      
      // Close the API configuration details window upon clicking Save to improve layout cleanliness
      setShowApiFields(false);
    } catch (e) {
      console.error("Failed to save settings to localStorage", e);
    }
  };

  // Helper: determine effective save directory
  const getEffectiveSavePath = (): string => {
    if (saveMode === 'custom' && customSavePath.trim()) {
      return customSavePath.trim();
    }
    return ''; // empty = use source file directory
  };

  // Helper: send source file directory to Electron main (DMG only)
const syncSourceDir = (fileList: File[]) => {
  const win = window as any;
  if (win.electronAPI?.setSourceDir && fileList.length > 0) {
    const firstFile = fileList[0];
    // In Electron, file.path gives full filesystem path; extract directory
    if ((firstFile as any).path) {
      const fullPath = (firstFile as any).path;
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      win.electronAPI.setSourceDir(dir).catch(() => {});
    }
  }
};
  useEffect(() => {
    const win = window as any;
    if (win.electronAPI?.setSavePath) {
      const effectivePath = saveMode === 'custom' ? customSavePath.trim() : '';
      win.electronAPI.setSavePath(effectivePath).catch(() => {});
    }
  }, [saveMode, customSavePath]);

  // Auto-save interactive drafts when translated paragraphs or statuses change
  useEffect(() => {
    if (interactiveStep === 'editing' && file && originalParagraphs.length > 0) {
      try {
        const draftObj = {
          fileName: file.name,
          translatedParagraphs,
          blockStatuses,
          activePage: activeInteractivePage,
          timestamp: Date.now()
        };
        localStorage.setItem(`joebook_draft_${file.name}`, JSON.stringify(draftObj));
      } catch (err) {
        console.error("Failed to auto-save interactive draft:", err);
      }
    }
  }, [interactiveStep, file, translatedParagraphs, blockStatuses, activeInteractivePage, originalParagraphs]);

  // Helper formatting bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          const parts = reader.result.split(',');
          resolve(parts[1] || '');
        } else {
          reject(new Error('Failed to read blob as Base64 string'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Preset Selection Action
  const handlePresetSelect = (preset: LlmPreset) => {
    setSelectedPreset(preset.id);
    
    // Extract unique configuration stored for this specific model preset to avoid leakage
    const savedForPreset = presetConfigs[preset.id] || {
      apiKey: preset.id === 'ollama' || preset.id === 'lmstudio' ? 'not-required' : '',
      baseUrl: preset.baseUrl,
      model: preset.defaultModel
    };

    setCustomApi({
      apiKey: savedForPreset.apiKey !== undefined ? savedForPreset.apiKey : '',
      baseUrl: savedForPreset.baseUrl || preset.baseUrl,
      model: savedForPreset.model || preset.defaultModel
    });

    setUseCustomApi(true);
    setFetchedModels([]);
    setModelsFetchError('');
    setShowApiFields(true); // Open the detail drawer when a new preset is chosen so the user can see/edit
  };

  const activeModelProfiles = modelProfiles.filter(p => p.enabled !== false);
  const modelProfileOptions = activeModelProfiles.length > 0 ? activeModelProfiles : modelProfiles;

  const getModelProfileById = (id?: string): ModelProfile | undefined => {
    if (!id) return undefined;
    return modelProfiles.find(p => p.id === id);
  };

  const saveCurrentModelAsProfile = () => {
    const modelName = customApi.model || (selectedPreset === 'custom' ? 'Custom Model' : selectedPreset);
    const profileName = `${selectedPreset === 'custom' ? 'Custom' : (llmPresets.find(p => p.id === selectedPreset)?.name || selectedPreset)} - ${modelName}`;
    const now = new Date().toISOString();
    const existingIdx = modelProfiles.findIndex(p => p.provider === selectedPreset && p.baseUrl === customApi.baseUrl && p.model === customApi.model);
    let next: ModelProfile[];
    let id: string;
    if (existingIdx >= 0) {
      id = modelProfiles[existingIdx].id;
      next = modelProfiles.map((p, i) => i === existingIdx ? { ...p, ...customApi, name: p.name || profileName, provider: selectedPreset, enabled: true, updatedAt: now } : p);
    } else {
      id = crypto.randomUUID();
      next = [...modelProfiles, { id, name: profileName, provider: selectedPreset, ...customApi, enabled: true, createdAt: now, updatedAt: now }];
    }
    setModelProfiles(next);
    setDefaultModelProfileId(id);
    if (!agentRoleProfileIds.planner && !agentRoleProfileIds.executor && !agentRoleProfileIds.proofreader) {
      setAgentRoleProfileIds({ planner: id, executor: id, proofreader: id });
    }
    setProfileNotice(currentLang === 'zh' ? `已保存模型档案：${profileName}` : `Saved model profile: ${profileName}`);
  };

  const applyProfileAsCurrentModel = (profile: ModelProfile) => {
    setSelectedPreset(profile.provider || 'custom');
    setCustomApi({ apiKey: profile.apiKey || '', baseUrl: profile.baseUrl || '', model: profile.model || '' });
    setUseCustomApi(true);
    setDefaultModelProfileId(profile.id);
    setShowApiFields(true);
  };

  const deleteModelProfile = (id: string) => {
    setModelProfiles(prev => prev.filter(p => p.id !== id));
    if (defaultModelProfileId === id) setDefaultModelProfileId('');
    setAgentRoleProfileIds(prev => ({
      planner: prev.planner === id ? '' : prev.planner,
      executor: prev.executor === id ? '' : prev.executor,
      proofreader: prev.proofreader === id ? '' : prev.proofreader,
    }));
  };

  const resolveAgentRoleApis = (): RoleApiMap => {
    const fallbackProfile = getModelProfileById(defaultModelProfileId);
    const fallback = fallbackProfile || { id: 'current', name: 'Current', provider: selectedPreset, enabled: true, createdAt: '', updatedAt: '', ...customApi };
    const toApi = (id: string) => {
      const p = getModelProfileById(id) || fallback;
      return { apiKey: p.apiKey || '', baseUrl: p.baseUrl || '', model: p.model || '' };
    };
    return {
      planner: toApi(agentRoleProfileIds.planner),
      executor: toApi(agentRoleProfileIds.executor),
      proofreader: toApi(agentRoleProfileIds.proofreader),
    };
  };

  const buildAgentPlanPayload = () => {
  const plan = planAgentAllocation({
  totalItems: files.length > 1 ? files.length : Math.max(originalParagraphs.length, files.length || 1),
  batchSize: 40,
  maxExecutors: agentMaxExecutors,
  enableProofreader: true,
  roleApi: resolveAgentRoleApis(),
  });
  const resolvedProfiles: Record<AgentRole, { apiKey: string; baseUrl: string; model: string } | null> = {
  planner: null,
  executor: null,
  proofreader: null,
  };
  for (const role of ['planner', 'executor', 'proofreader'] as AgentRole[]) {
  const p = getModelProfileById(agentRoleProfileIds[role]) || getModelProfileById(defaultModelProfileId);
  if (p) {
  resolvedProfiles[role] = { apiKey: p.apiKey || '', baseUrl: p.baseUrl || '', model: p.model || '' };
  } else {
  // Fallback: use the current customApi from the UI so roles never ship as null.
  // This ensures multi-agent orchestration works even without saved model profiles.
  resolvedProfiles[role] = {
  apiKey: customApi.apiKey || 'not-required',
  baseUrl: customApi.baseUrl || '',
  model: customApi.model || '',
  };
  }
  }
  return {
  ...plan,
  enabled: agentOrchestrationEnabled,
  roleProfileIds: agentRoleProfileIds,
  modelProfiles: resolvedProfiles,
  };
  };


// ── Language detection ──
const LANG_PATTERNS: Record<string, RegExp> = {
  'en': /^[a-zA-Z\s\-]+$/,
  'zh-CN': /[\u4e00-\u9fff]/,
  'zh-TW': /[\u4e00-\u9fff]/,
  'ja': /[\u3040-\u309f\u30a0-\u30ff]/,
  'ko': /[\uac00-\ud7af]/,
  'fr': /^[a-zA-Z\u00c0-\u017f\s\-]+$/,
  'de': /^[a-zA-Z\u00c4\u00e4\u00d6\u00f6\u00dc\u00fc\u00df\s\-]+$/,
  'es': /^[a-zA-Z\u00e1\u00e9\u00ed\u00f1\u00f3\u00fa\u00fc\s\-]+$/,
  'ar': /[\u0600-\u06ff]/,
  'ru': /[\u0400-\u04ff]/,
};

function detectLanguage(text: string): string {
  if (!text.trim()) return 'Auto';
  if (LANG_PATTERNS['zh-CN'].test(text)) return 'zh-CN';
  if (LANG_PATTERNS['ja'].test(text)) return 'ja';
  if (LANG_PATTERNS['ko'].test(text)) return 'ko';
  if (LANG_PATTERNS['ar'].test(text)) return 'ar';
  if (LANG_PATTERNS['ru'].test(text)) return 'ru';
  if (LANG_PATTERNS['fr'].test(text)) return 'fr';
  if (LANG_PATTERNS['de'].test(text)) return 'de';
  if (LANG_PATTERNS['es'].test(text)) return 'es';
  if (LANG_PATTERNS['en'].test(text)) return 'en';
  return 'Auto';
}
  // Pull / Fetch available models from custom API endpoint dynamically
  const getActiveGlossaryTerms = async () => {
    const terms = await loadTermbase();
    if (!termbaseEnabled) {
      setTermbaseEntries(terms);
      return [];
    }
    const active = terms
      .filter(t => (!t.sourceLang || t.sourceLang === sourceLang || sourceLang === 'Auto') && (!t.targetLang || t.targetLang === targetLang))
      .sort((a, b) => (b.confirmed === a.confirmed ? b.frequency - a.frequency : b.confirmed ? 1 : -1))
      .slice(0, 120)
      .map(t => ({ source: t.source, target: t.target }));
    setTermbaseEntries(terms);
    return active;
  };

  const handleImportTermComparison = async () => {
    const parsed = parseTermComparisonText(termComparisonText, { sourceLang, targetLang, domain: 'custom', confirmed: true });
    if (parsed.length === 0) {
      setTermbaseNotice(currentLang === 'zh' ? '未识别到有效术语，请使用 source => target 格式。' : 'No valid terms detected. Use source => target format.');
      return;
    }
    const result = await addTerms(parsed as NewTermEntry[]);
    setTermbaseEntries(result.entries);
    setTermbaseNotice(currentLang === 'zh' ? `已新增 ${result.imported} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条。` : `Added ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`);
    setTermComparisonText('');
  };

  const handleSeedDefaultTerms = async () => {
    const result = await seedDefaultTermbase();
    setTermbaseEntries(result.entries);
    setTermbaseNotice(currentLang === 'zh' ? `默认术语库已导入/更新：新增 ${result.imported} 条，更新 ${result.updated} 条。` : `Default termbase imported/updated: ${result.imported} added, ${result.updated} updated.`);
  };

  const handleUpdateTerm = async (id: string, updates: Partial<TermEntry>) => {
    await updateTerm(id, updates);
    setTermbaseEntries(await loadTermbase());
  };

  const handleDeleteTerm = async (id: string) => {
    await deleteTerm(id);
    setTermbaseEntries(await loadTermbase());
  };

  const fileImportRef = useRef<HTMLInputElement>(null);
  const [importingFile, setImportingFile] = useState(false);

  const handleFileImportTerms = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingFile(true);
    setTermbaseNotice('');
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      let imported = 0, skipped = 0;
      if (ext === 'json') {
        const { importTermbaseJSON } = await import('./termbase');
        const result = await importTermbaseJSON(text, true);
        imported = result.imported; skipped = result.skipped;
      } else if (ext === 'csv') {
        const { importTermbaseCSV } = await import('./termbase');
        const result = await importTermbaseCSV(text);
        imported = result.imported; skipped = result.skipped;
      } else {
        const { parseTermComparisonText, addTerms: addT } = await import('./termbase');
        const detectedSourceLang = detectLanguage(text.split(/[\n=>→]/)[0] || text.substring(0, 50));
        const entries = parseTermComparisonText(text, { sourceLang: detectedSourceLang, targetLang, domain: 'imported', confirmed: true });
        if (entries.length === 0) {
          setTermbaseNotice(currentLang === 'zh' ? '未识别到有效术语。支持 JSON/CSV/文本格式。' : 'No valid terms detected. Supports JSON/CSV/text formats.');
          setImportingFile(false);
          if (fileImportRef.current) fileImportRef.current.value = '';
          return;
        }
        const result = await addT(entries as any);
        imported = result.imported; skipped = result.skipped;
      }
      const latest = await loadTermbase();
      setTermbaseEntries(latest);
      setTermbaseNotice(currentLang === 'zh' ? `已从文件 "${file.name}" 导入 ${imported} 条，跳过 ${skipped} 条。` : `Imported ${imported}, skipped ${skipped} from "${file.name}".`);
    } catch (err: any) {
      setTermbaseNotice(currentLang === 'zh' ? `导入失败: ${err.message}` : `Import failed: ${err.message}`);
    } finally {
      setImportingFile(false);
      if (fileImportRef.current) fileImportRef.current.value = '';
    }
  };
  const learnTermsFromEdit = async (idx: number, oldTranslation: string, newTranslation: string) => {
    const candidates = extractTermCandidates(originalParagraphs[idx] || '', oldTranslation || '', newTranslation || '')
      .filter(c => c.confidence >= 0.5 && c.source && c.target)
      .slice(0, 3);
    for (const c of candidates) {
      await addTerm({ source: c.source, target: c.target, sourceLang, targetLang, domain: 'proofread', confirmed: false });
    }
    if (candidates.length > 0) {
      const latest = await loadTermbase();
      setTermbaseEntries(latest);
      setTermbaseNotice(currentLang === 'zh' ? `已从本次校对学习 ${candidates.length} 条术语候选。` : `Learned ${candidates.length} term candidates from proofreading.`);
    }
  };

  const currentAgentPlan = buildAgentPlanPayload();

  const fetchAvailableModels = async () => {
    if (!customApi.baseUrl) {
      setModelsFetchError(currentLang === 'zh' ? '请先填写 API 接口地址 (Base URL)' : 'Please enter API Base URL first');
      return;
    }
    setIsFetchingModels(true);
    setModelsFetchError('');
    setFetchedModels([]);
    try {
      const resp = await fetch('/api/fetch-models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          baseUrl: customApi.baseUrl,
          apiKey: customApi.apiKey
        })
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.success && Array.isArray(data.models)) {
        if (data.models.length === 0) {
          setModelsFetchError(currentLang === 'zh' ? '连接成功，但未检索到任何可用模型标识' : 'Connected successfully, but no available model identifiers retrieved');
        } else {
          setFetchedModels(data.models);
        }
      } else {
        throw new Error(data.error || 'Unknown response structure received');
      }
    } catch (err: any) {
      console.error('Fetch models error:', err);
      setModelsFetchError(err.message || String(err));
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Language Switch Action
  const toggleLanguage = () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    setCurrentLang(nextLang);
    localStorage.setItem('trans_ui_language', nextLang);
  };

  // Dragger actions
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Immediately extract source directory from the first file's path (Electron only)
      const win = window as any;
      const firstFile = e.target.files[0];
      if (win.electronAPI?.setSourceDir && (firstFile as any).path) {
        const fullPath = (firstFile as any).path;
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        setSourceDirPath(dir);
        win.electronAPI.setSourceDir(dir).catch(() => {});
      }
      validateAndAddFiles(e.target.files);
    }
  };

  const validateAndAddFiles = (fileList: FileList | File[]) => {
    const allowed = ['docx', 'pptx', 'epub', 'md', 'pdf'];
    const MAX_FILES = 10;
    const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
    const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB
    
    const validFiles: File[] = [];
    let customError = '';
    let totalSize = 0;

    const filesArray = Array.from(fileList);

    // Filter and slice to max 10 files
    const filesToProcess = filesArray.slice(0, MAX_FILES);
    if (filesArray.length > MAX_FILES) {
      customError = currentLang === 'zh' 
        ? `⚠️ 一次最多支持上传 ${MAX_FILES} 个文档进行大容量批处理，已自动为您筛选前 ${MAX_FILES} 个文档。`
        : `⚠️ Maximum batch of ${MAX_FILES} documents is supported. Automatically kept the first ${MAX_FILES} files.`;
    }

    for (const f of filesToProcess) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (!ext || !allowed.includes(ext)) {
        customError = currentLang === 'zh'
          ? `⚠️ 暂不支持文件 "${f.name}" 的格式！目前支持: ${allowed.join(', ').toUpperCase()}`
          : `⚠️ Suffix of "${f.name}" is unsupported! Allowed: ${allowed.join(', ').toUpperCase()}`;
        continue;
      }

      if (f.size > MAX_FILE_SIZE) {
        customError = currentLang === 'zh'
          ? `⚠️ 文件 "${f.name}" 超过单文件 200MB 的限制 (大小: ${formatBytes(f.size)})。`
          : `⚠️ File "${f.name}" exceeds the 200MB single-file size safeguard (size: ${formatBytes(f.size)}).`;
        continue;
      }

      validFiles.push(f);
      totalSize += f.size;
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      customError = currentLang === 'zh'
        ? `⚠️ 上传文件总体积超过 500MB 的最大限制。请减小分批数量或进行分段翻译以保护浏览器稳定性。`
        : `⚠️ Combined files batch size exceeds 500MB capacity. Please divide them into smaller runs.`;
      setErrorMessage(customError);
      return;
    }

    if (validFiles.length > 0) {
      setFiles(prev => {
        const merged = [...prev, ...validFiles];
        syncSourceDir(merged);
        // Warn if total exceeds 10
        if (merged.length > 10 && !customError) {
          customError = currentLang === 'zh' 
            ? `⚠️ 当前文件列表共 ${merged.length} 个文档，超过 10 个建议分批次翻译以确保稳定性。`
            : `⚠️ ${merged.length} files in queue. For stability, consider splitting into batches of 10 or fewer.`;
        }
        return merged;
      });
      setActiveIndex(0);
      setErrorMessage(customError);
      setTranslationFinished(false);
      setResultPayload(null);
      setWorkspaceResults([]);
      resetTranslationState();
    } else if (customError) {
      setErrorMessage(customError);
    }
  };

  const handleSwitchFile = (idx: number) => {
    setActiveIndex(idx);
    setTranslationFinished(false);
    setResultPayload(null);
    setErrorMessage('');
  };

  const removeFileAt = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = files.filter((_, i) => i !== idx);
    setFiles(updated);
    if (activeIndex >= updated.length) {
      setActiveIndex(Math.max(0, updated.length - 1));
    }
    setTranslationFinished(false);
    setResultPayload(null);
    setErrorMessage('');
    if (updated.length === 0 && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Clear current upload (compatible helper)
  const removeFile = () => {
    setShowClearConfirm(true);
  };

  const confirmClearFiles = () => {
    setShowClearConfirm(false);
    setFiles([]);
    setActiveIndex(0);
    setTranslationFinished(false);
    setResultPayload(null);
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Start checking progress from server
  const startPollingProgress = (sId: string, sourceFile?: File | null) => {
    if (progressPollingRef.current) clearInterval(progressPollingRef.current);
    isDownloadingRef.current = false;
    
    progressPollingRef.current = setInterval(async () => {
      if (isDownloadingRef.current) return;
      try {
        const response = await fetch(`/api/progress/${sId}`);
        if (response.ok) {
          const data = await response.json();
 setProgressPercent(typeof data.progress === 'number' ? data.progress : 0);
 setStagesMessage(data.status || 'Translating segments...');
          
          if (data.error) {
              clearInterval(progressPollingRef.current);
              setErrorMessage(data.errorMsg || data.status);
              setIsTranslating(false);
              if (batchResolveRef.current) {
                const resolveFn = batchResolveRef.current;
                batchResolveRef.current = null;
                resolveFn(false);
              }
          } else if (data.outputReady) {
            if (isDownloadingRef.current) return;
            isDownloadingRef.current = true;
            clearInterval(progressPollingRef.current);
            await handleDownloadCachedResult(sId, sourceFile || files[activeIndex] || null);
          }
        }
      } catch (err) {
        // quiet fallback
      }
 }, 1200);
 };

 // Start polling the multi-agent orchestrator progress
 const startOrchestratorPolling = (documentId: string, sourceFile?: File | null) => {
 if (progressPollingRef.current) clearInterval(progressPollingRef.current);
 isDownloadingRef.current = false;
 
 progressPollingRef.current = setInterval(async () => {
 if (isDownloadingRef.current) return;
 try {
 const response = await fetch('/api/orchestrator/progress/' + documentId);
 if (response.ok) {
 const data = await response.json();
 setProgressPercent(typeof data.progress === 'number' ? data.progress : 0);
 
 // Map orchestrator phases to display messages
 const phaseMessages: Record<string, string> = {
 planning: currentLang === 'zh' ? '规划智能体分析文档结构与术语...' : 'Planner analyzing document structure...',
 executing: data.status || (currentLang === 'zh' ? '执行智能体并行翻译中...' : 'Executor agents translating...'),
 reviewing: currentLang === 'zh' ? '校对智能体质量检查中...' : 'Reviewer performing quality checks...',
 completed: currentLang === 'zh' ? '多智能体流水线完成' : 'Multi-agent pipeline completed',
 failed: currentLang === 'zh' ? '流水线失败' : 'Pipeline failed',
 };
 setStagesMessage(phaseMessages[data.phase] || data.status || 'Processing...');
 if (data.phase === 'executing') setAgentStatus(data.status || '');
 
 if (data.phase === 'failed' || data.progress === -1) {
 clearInterval(progressPollingRef.current);
 setErrorMessage(data.status || 'Pipeline failed');
 setIsTranslating(false);
 if (batchResolveRef.current) {
 const resolveFn = batchResolveRef.current;
 batchResolveRef.current = null;
 resolveFn(false);
 }
 } else if (data.phase === 'completed' && data.result) {
 // Pipeline done — now trigger the normal download flow
 // using the original session ID pattern
 clearInterval(progressPollingRef.current);
 setProgressPercent(100);
 setStagesMessage(currentLang === 'zh' ? '多智能体翻译完成，正在下载...' : 'Multi-agent translation complete, downloading...');
 // Fall through to standard download path
 if (!isDownloadingRef.current) {
 isDownloadingRef.current = true;
 await handleDownloadCachedResult(documentId, sourceFile || files[activeIndex] || null);
 }
 }
 }
 } catch (err) {
 // quiet fallback
 }
 }, 1500);
 };

 const handleDownloadCachedResult = async (sId: string, sourceFile?: File | null) => {
      try {
        const response = await fetch(`/api/translate-download/${sId}`);
        
        if (!response.ok) {
          let errData: any = {};
          let extra = '';
          try {
            const text = await response.text();
            extra = text.substring(0, 500);
            errData = JSON.parse(text);
          } catch(e) {}
          throw new Error(errData.error || `Server HTTP Error: (${response.status} ${response.statusText}) ${extra}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const payload = await response.json();
          const effectiveFile = sourceFile || file;
          const workspaceItem: WorkspaceResultItem = {
            id: sId,
            sourceFileName: effectiveFile?.name || payload.outputName || 'translated_file',
            format: 'PDF (Dual Output)',
            targetLang,
            result: payload
          };
          appendWorkspaceResult(workspaceItem);
          
          // Add to history
          if (effectiveFile) {
            const newHistoryItem: TranslationHistoryItem = {
              id: sId,
              name: effectiveFile.name,
              size: formatBytes(effectiveFile.size),
              sourceLang,
              targetLang,
              timestamp: new Date().toLocaleTimeString(),
              format: 'PDF (Dual Output)',
              pdfBase64: payload.pdfBase64,
              docxBase64: payload.docxBase64,
              textContent: payload.textContent,
            };
            saveHistory((prev) => [newHistoryItem, ...prev]);
          }

          // Auto trigger download for PDF
          if (payload.pdfBase64) {
            try {
              downloadBase64File(payload.pdfBase64, 'application/pdf', payload.outputName || 'Translated_Report.pdf');
            } catch (err) { }
          }
        } else {
          const blob = await response.blob();
          const effectiveFile = sourceFile || file;
          
          let dispositionName = effectiveFile ? effectiveFile.name.replace(/\.[^/.]+$/, "") + `_${targetLang}.${effectiveFile.name.split('.').pop()}` : `translated_${targetLang}.file`;
          const disposition = response.headers.get('content-disposition');
          if (disposition && disposition.indexOf('filename=') !== -1) {
            const match = disposition.match(/filename="?([^";]+)"?/);
            if (match && match[1]) {
              dispositionName = decodeURIComponent(match[1]);
            }
          }

          const payload: ResultPayload = {
            directDownloadBlob: blob,
            directDownloadName: dispositionName
          };
          appendWorkspaceResult({
            id: sId,
            sourceFileName: effectiveFile?.name || dispositionName,
            format: effectiveFile?.name.split('.').pop()?.toUpperCase() || 'DOC',
            targetLang,
            result: payload
          });

          // Add to history
          if (effectiveFile) {
            const b64 = await blobToBase64(blob).catch(() => undefined);
            const newHistoryItem: TranslationHistoryItem = {
              id: sId,
              name: effectiveFile.name,
              size: formatBytes(effectiveFile.size),
              sourceLang,
              targetLang,
              timestamp: new Date().toLocaleTimeString(),
              format: effectiveFile.name.split('.').pop()?.toUpperCase() || 'DOC',
              fileBase64: b64
            };
            saveHistory((prev) => [newHistoryItem, ...prev]);
          }

          // Auto-download direct file
          try {
            downloadResultPayload(payload);
          } catch (err) { }
        }

        setProgressPercent(100);
        setStagesMessage(currentLang === 'zh' ? '排版完美对齐翻译成果已成功保存！' : 'Flipped translation matched securely.');
        setTranslationFinished(true);
        if (batchResolveRef.current) {
          const resolveFn = batchResolveRef.current;
          batchResolveRef.current = null;
          resolveFn(true);
        }
      } catch (err: any) {
        console.error(err);
        setErrorMessage(err.message || 'Error occurred while downloading result.');
        if (batchResolveRef.current) {
          const resolveFn = batchResolveRef.current;
          batchResolveRef.current = null;
          resolveFn(false);
        }
      } finally {
        // isTranslating is controlled by the outer single/batch run lifecycle
      }
  };

  // Interactive Step: Parse the document structure into standard arrays
  const handleIntelligentParse = async () => {
    if (!file) return;
    if (file.size === 0) {
      setErrorMessage(currentLang === 'zh'
        ? '💡 当前处于历史记录载入预览状态，未离线缓存本地原始文件。请在此重新拖入/上传您的本地原始文件再进行分步句对校对。'
        : '💡 Loaded from history preview state. Local source file not cached. Please re-upload your local source file here to start interactive proofreading.');
      return;
    }
    setInteractiveStep('parsing');
    setErrorMessage('');
    setResultPayload(null);
    setProgressPercent(15);
    setStagesMessage(currentLang === 'zh' ? '正在提取文档原始排版、样式与文本骨架句对...' : 'Deconstructing original document layout nodes and sentence pairs...');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 120000);
      const response = await fetch('/api/parse-document', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      window.clearTimeout(timeoutId);
      
      if (!response.ok) {
        let errMsg = '';
        try {
          const errData = await response.json();
          errMsg = errData.error;
        } catch (_) {
          try {
            errMsg = await response.text();
          } catch (__) {
            errMsg = currentLang === 'zh' ? '解析文件服务端错误' : 'Parse document server error';
          }
        }
        throw new Error(errMsg || (currentLang === 'zh' ? '解析文件失败' : 'Failed to parse file element tree'));
      }
      
      const data = await response.json();
      const parsedParagraphs = data.paragraphs || [];
      
      if (parsedParagraphs.length === 0) {
        throw new Error(currentLang === 'zh' ? '该文档未提取到任何可翻译的文本。' : 'No translatable elements detected inside catalog.');
      }
      
      setOriginalParagraphs(parsedParagraphs);
      
      const draftKey = `joebook_draft_${file.name}`;
      const savedDraftStr = localStorage.getItem(draftKey);
      let loadedFromDraft = false;
      
      if (savedDraftStr) {
        try {
          const draft = JSON.parse(savedDraftStr);
          if (draft && draft.translatedParagraphs && draft.translatedParagraphs.length === parsedParagraphs.length) {
            setTranslatedParagraphs(draft.translatedParagraphs);
            setBlockStatuses(draft.blockStatuses || new Array(parsedParagraphs.length).fill('edited'));
            setActiveInteractivePage(draft.activePage || 0);
            loadedFromDraft = true;
            
            setDraftRestoredNotification(currentLang === 'zh' 
              ? '📂 检测到您对该文档有未完成的本地校对草稿，已为您自动恢复并载入已保存进度！' 
              : '📂 Unfinished local proofreading draft detected and auto-restored for this document!');
            
            setTimeout(() => {
              setDraftRestoredNotification(null);
            }, 6000);
          }
        } catch (_) {}
      }
      
      if (!loadedFromDraft) {
        setTranslatedParagraphs(new Array(parsedParagraphs.length).fill(''));
        setBlockStatuses(new Array(parsedParagraphs.length).fill('pending'));
        
        setInteractiveFileMeta({
          name: data.fileName || file.name,
          type: data.fileType || file.name.split('.').pop() || 'docx',
          totalBlocks: parsedParagraphs.length
        });
        
        setActiveInteractivePage(0);
        setInteractiveStep('editing');
        
        // Fire progressive translations sequence
        translateAllChunksInGroups(parsedParagraphs);
      } else {
        setInteractiveFileMeta({
          name: data.fileName || file.name,
          type: data.fileType || file.name.split('.').pop() || 'docx',
          totalBlocks: parsedParagraphs.length
        });
        
        setInteractiveStep('editing');
        
        // Resume any pending background translations from draft
        translateAllChunksInGroups(parsedParagraphs);
      }
    } catch (err: any) {
      console.error('Interactive parsing failed:', err);
      const isAbort = err?.name === 'AbortError';
      const fallbackMessage = currentLang === 'zh'
        ? (isAbort
            ? '解析请求超时。请稍后重试，或检查当前服务端端口 7050 是否可访问。'
            : '解析请求失败。请检查服务端是否已启动、7050 端口是否可访问，或稍后重试。')
        : (isAbort
            ? 'Parse request timed out. Please retry, or verify that the server on port 7050 is reachable.'
            : 'Parse request failed. Please verify that the server is running and port 7050 is reachable, then try again.');
      const message = !err?.message || err.message === 'Failed to fetch' ? fallbackMessage : err.message;
      setErrorMessage(message);
      setInteractiveStep('idle');
    }
  };

  // Specific immediate priority translator for current page or single block
  const translateSpecificChunks = async (indices: number[]) => {
    // Avoid double translating or empty indices
    const indicesToTranslate = indices.filter(idx => {
      const currentStatus = blockStatusesRef.current[idx];
      return currentStatus === 'pending' || !translatedParagraphsRef.current[idx];
    });
    if (indicesToTranslate.length === 0) return;
    
    // Mark as translating
    setBlockStatuses(prev => {
      const cloned = [...prev];
      indicesToTranslate.forEach(idx => { cloned[idx] = 'translating'; });
      return cloned;
    });
    
    try {
      const batchTexts = indicesToTranslate.map(idx => originalParagraphs[idx]);
      const payload: any = {
        texts: batchTexts,
        sourceLang,
        targetLang,
        tone
      };

      if (useCustomApi) {
        payload.customApiKey = customApi.apiKey;
        payload.customBaseUrl = customApi.baseUrl;
        payload.customModel = customApi.model;
      }
      payload.glossaryTerms = await getActiveGlossaryTerms();
      if (agentOrchestrationEnabled) {
        payload.agentPlan = currentAgentPlan;
        setAgentStatus(currentAgentPlan.summary);
      }

      const response = await fetch('/api/translate-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        let errMsg = "Priority translation failed";
        try {
          const errData = await response.json();
          if (errData && errData.error) errMsg = errData.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      
      const data = await response.json();
      const resultList = data.translations || [];
      
      setTranslatedParagraphs(prev => {
        const cloned = [...prev];
        indicesToTranslate.forEach((idx, bIdx) => {
          cloned[idx] = resultList[bIdx] || originalParagraphs[idx];
        });
        return cloned;
      });
      
      setBlockStatuses(prev => {
        const cloned = [...prev];
        indicesToTranslate.forEach(idx => { cloned[idx] = 'done'; });
        return cloned;
      });
    } catch (err: any) {
      console.error("Priority translation error:", err);
      // Fallback
      setTranslatedParagraphs(prev => {
        const cloned = [...prev];
        indicesToTranslate.forEach(idx => {
          cloned[idx] = originalParagraphs[idx];
        });
        return cloned;
      });
      setBlockStatuses(prev => {
        const cloned = [...prev];
        indicesToTranslate.forEach(idx => { cloned[idx] = 'done'; });
        return cloned;
      });
    }
  };

  // Progressive background batch translation runner
  const translateAllChunksInGroups = async (paragraphsList: string[]) => {
    const listLen = paragraphsList.length;
    
    for (let i = 0; i < listLen; i += ITEMS_PER_PAGE) {
      const batchIdxs: number[] = [];
      const batchTexts: string[] = [];
      
      for (let k = i; k < Math.min(i + ITEMS_PER_PAGE, listLen); k++) {
        const currentStatus = blockStatusesRef.current[k];
        const isPending = currentStatus === 'pending' || !translatedParagraphsRef.current[k];
        if (isPending && currentStatus !== 'translating' && currentStatus !== 'done' && currentStatus !== 'edited') {
          batchIdxs.push(k);
          batchTexts.push(paragraphsList[k]);
        }
      }

      if (batchIdxs.length === 0) {
        continue; // Already processed by page priority or draft!
      }
      
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      // Double check status before committing
      const activePendingIdxs = batchIdxs.filter(idx => {
        const currentStatus = blockStatusesRef.current[idx];
        return (currentStatus === 'pending' || !translatedParagraphsRef.current[idx]) && currentStatus !== 'translating';
      });
      if (activePendingIdxs.length === 0) continue;

      // Mark as translating
      setBlockStatuses(prev => {
        const cloned = [...prev];
        activePendingIdxs.forEach(idx => { cloned[idx] = 'translating'; });
        return cloned;
      });
      
      try {
        const activeTexts = activePendingIdxs.map(idx => paragraphsList[idx]);
        const payload: any = {
          texts: activeTexts,
          sourceLang,
          targetLang,
          tone
        };

        if (useCustomApi) {
          payload.customApiKey = customApi.apiKey;
          payload.customBaseUrl = customApi.baseUrl;
          payload.customModel = customApi.model;
        }
        payload.glossaryTerms = await getActiveGlossaryTerms();
        if (agentOrchestrationEnabled) {
          payload.agentPlan = currentAgentPlan;
          setAgentStatus(currentAgentPlan.summary);
        }

        const response = await fetch('/api/translate-chunks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
          let errMsg = "Batch translation failed";
          try {
            const errData = await response.json();
            if (errData && errData.error) errMsg = errData.error;
          } catch (_) {}
          throw new Error(errMsg);
        }
        
        const data = await response.json();
        const resultList = data.translations || [];
        
        setTranslatedParagraphs(prev => {
          const cloned = [...prev];
          activePendingIdxs.forEach((idx, bIdx) => {
            cloned[idx] = resultList[bIdx] || paragraphsList[idx];
          });
          return cloned;
        });
        
        setBlockStatuses(prev => {
          const cloned = [...prev];
          activePendingIdxs.forEach(idx => { cloned[idx] = 'done'; });
          return cloned;
        });
      } catch (err: any) {
        console.error("Batch group translation error at index:", i, err);
        // Fallback to original text to prevent getting stuck
        setTranslatedParagraphs(prev => {
          const cloned = [...prev];
          activePendingIdxs.forEach((idx) => {
            cloned[idx] = paragraphsList[idx];
          });
          return cloned;
        });
        setBlockStatuses(prev => {
          const cloned = [...prev];
          activePendingIdxs.forEach(idx => { cloned[idx] = 'done'; });
          return cloned;
        });
      }
    }
  };

  // Auto page-switch prioritized active items translator trigger
  useEffect(() => {
    if (interactiveStep !== 'editing' || originalParagraphs.length === 0) return;

    const filteredParagraphs = originalParagraphs
      .map((original, idx) => ({ original, idx, translated: translatedParagraphs[idx] || '' }));
    
    const totalBlocks = filteredParagraphs.length;
    const totalPages = Math.ceil(totalBlocks / ITEMS_PER_PAGE);
    const activePage = Math.min(activeInteractivePage, Math.max(0, totalPages - 1));
    const pagedItems = filteredParagraphs.slice(activePage * ITEMS_PER_PAGE, (activePage + 1) * ITEMS_PER_PAGE);
    
    const pendingIndices = pagedItems
      .filter(item => blockStatuses[item.idx] === 'pending' || !translatedParagraphs[item.idx])
      .map(item => item.idx);
      
    if (pendingIndices.length > 0) {
      console.log(`[优先即时翻译] 检测到切换至新视图：优先自动翻译第 ${activePage + 1} 页、句段索引 [${pendingIndices.join(', ')}]...`);
      translateSpecificChunks(pendingIndices);
    }
  }, [activeInteractivePage, interactiveStep, originalParagraphs]);

  // Build document layout using custom edits we proofread
  const handleInteractiveRepack = async (bypassConfirm = false) => {
    if (!file) return;
    if (file.size === 0) {
      setErrorMessage(currentLang === 'zh'
        ? '💡 无法直接重排历史缓存。请在上方拖放或重新选择该原始文件再进行校对与排版重构。'
        : '💡 Cannot repack from a cached history item directly. Please drag or rechoose your original source document above to repack.');
      setIsRepacking(false);
      return;
    }
    setIsRepacking(true);
    setErrorMessage('');
    
    // Quick validation
    const incompleteIndex = blockStatuses.findIndex(status => status === 'pending' || status === 'translating');
    if (incompleteIndex !== -1 && !bypassConfirm) {
      setShowRepackConfirm(true);
      setIsRepacking(false);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('targetLang', targetLang);
    formData.append('editedTranslationsJson', JSON.stringify(translatedParagraphs));
    
    try {
      const response = await fetch('/api/repack-document', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || (currentLang === 'zh' ? '重组排版文档失败' : 'Failed to repack layout elements'));
      }
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const payload = await response.json();
        setResultPayload(payload);
        
        // Add to history list
        const newHistoryItem: TranslationHistoryItem = {
          id: 'sess_' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          size: formatBytes(file.size),
          sourceLang,
          targetLang,
          timestamp: new Date().toLocaleTimeString(),
          format: 'PDF (Dual Core Corrected)',
          pdfBase64: payload.pdfBase64,
          docxBase64: payload.docxBase64,
          textContent: payload.textContent,
        };
        saveHistory([newHistoryItem, ...history]);

        // Auto trigger download for PDF
        if (payload.pdfBase64) {
          try {
            downloadBase64File(payload.pdfBase64, 'application/pdf', payload.outputName || 'Translated_Report.pdf');
          } catch (err) {
            console.error("Auto open/download of PDF report failed:", err);
          }
        }
      } else {
        const blob = await response.blob();
        let dispositionName = file.name.replace(/\.[^/.]+$/, "") + `_${targetLang}_corrected.${file.name.split('.').pop()}`;
        
        const disposition = response.headers.get('content-disposition');
        if (disposition && disposition.indexOf('filename=') !== -1) {
          const match = disposition.match(/filename="?([^";]+)"?/);
          if (match && match[1]) {
            dispositionName = decodeURIComponent(match[1]);
          }
        }
        
        setResultPayload({
          directDownloadBlob: blob,
          directDownloadName: dispositionName
        });
        
        const b64 = await blobToBase64(blob).catch(() => undefined);
        const newHistoryItem: TranslationHistoryItem = {
          id: 'sess_' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          size: formatBytes(file.size),
          sourceLang,
          targetLang,
          timestamp: new Date().toLocaleTimeString(),
          format: file.name.split('.').pop()?.toUpperCase() || 'DOC',
          fileBase64: b64
        };
        saveHistory([newHistoryItem, ...history]);

        // Auto-download direct file
        try {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = dispositionName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        } catch (err) {
          console.error("Auto trigger direct download failed:", err);
        }
      }
      
      // Clear local draft state upon successful repack completion
      try {
        localStorage.removeItem(`joebook_draft_${file.name}`);
      } catch (_) {}

      setTranslationFinished(true);
      setInteractiveStep('idle');
      setIsInteractiveMode(false);
    } catch (err: any) {
      console.error('Interactive repack failed:', err);
      setErrorMessage(err.message || '导出重组对齐文档失败。');
    } finally {
      setIsRepacking(false);
    }
  };

  // JoEbook editor utility: batch find and replace across translated blocks
  const handleGlobalReplace = () => {
    if (!findQuery) return;
    let count = 0;
    const nextTranslations = translatedParagraphs.map((txt) => {
      if (txt && txt.includes(findQuery)) {
        count++;
        return txt.replaceAll(findQuery, replaceQuery);
      }
      return txt;
    });

    if (count > 0) {
      setTranslatedParagraphs(nextTranslations);
      setBlockStatuses(prev => {
        const next = [...prev];
        translatedParagraphs.forEach((txt, idx) => {
          if (txt && txt.includes(findQuery)) {
            next[idx] = 'edited';
          }
        });
        return next;
      });
      alert(currentLang === 'zh' 
        ? `成功！已在译文中批量检索并替换 ${count} 处匹配的词汇。` 
        : `Success! Automatically replaced ${count} matching terms inside translation blocks.`);
    } else {
      alert(currentLang === 'zh' 
        ? `未在现有译文句对中查找到 "${findQuery}"` 
        : `No matching term "${findQuery}" found in the existing translations.`);
    }
    setFindQuery('');
    setReplaceQuery('');
  };

  // JoEbook editor utility: call background service to polish a single paragraph
  const handleSingleParaPolish = async (idx: number, style: string) => {
    if (blockStatuses[idx] === 'pending' || blockStatuses[idx] === 'translating') return;
    setPolishBlockIdx(idx);
    setIsPolishing(true);

    try {
      const originalText = originalParagraphs[idx];
      const currentTranslation = translatedParagraphs[idx] || originalText;
      
      const payload: any = {
        texts: [originalText],
        sourceLang,
        targetLang,
        tone: style, // Use style as tone parameter
        polishOnly: true,
        currentTranslation
      };

      if (useCustomApi) {
        payload.customApiKey = customApi.apiKey;
        payload.customBaseUrl = customApi.baseUrl;
        payload.customModel = customApi.model;
      }

      const response = await fetch('/api/translate-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errMsg = "AI Polish failed";
        try {
          const errData = await response.json();
          if (errData && errData.error) errMsg = errData.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      const polishedText = data.translations && data.translations[0];
      
      if (polishedText) {
        setTranslatedParagraphs(prev => {
          const next = [...prev];
          next[idx] = polishedText;
          return next;
        });
        setBlockStatuses(prev => {
          const next = [...prev];
          next[idx] = 'edited';
          return next;
        });
      }
    } catch (err: any) {
      console.error("Single paragraph polish failed:", err);
      setErrorMessage(err.message || String(err));
    } finally {
      setIsPolishing(false);
      setPolishBlockIdx(null);
    }
  };

  // Batch Translation Trigger Action
  const handleBatchTranslate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;

    setIsBatchProcessing(true);
    setTranslationFinished(false);
    setResultPayload(null);
    setErrorMessage('');

    try {
      for (let i = 0; i < files.length; i++) {
        setBatchCurrentIndex(i);
        setActiveIndex(i);
        await new Promise(resolve => setTimeout(resolve, 250));
        const success = await new Promise<boolean>((resolve) => {
          batchResolveRef.current = resolve;
          setNextBatchIdxToStart(i);
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      setTranslationFinished(true);
      setProgressPercent(100);
      setStagesMessage(currentLang === 'zh' ? '🎉 全部批量文档的排版重构翻译已成功完成并自动下载！' : '🎉 All batch documents layout rebuild & translation successfully processed!');
    } catch (err) {
      console.error('Batch translation error:', err);
      setErrorMessage(currentLang === 'zh' ? '批量翻译过程中出错' : 'Error during batch translation');
    } finally {
      resetTranslationState();
    }
  };

  // Translation Trigger Action
  const handleTranslate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    console.log('[handleTranslate] entry | file=', file?.name, '| files.length=', files.length, '| isInteractiveMode=', isInteractiveMode, '| agentOrchestrationEnabled=', agentOrchestrationEnabled, '| isTranslating=', isTranslating);

    // When multi-agent orchestration is enabled, force Direct mode (not Babel/Interactive).
    // Babel mode only does DOM parsing; it never calls /api/translate, so the
    // Planner→Executor→Reviewer pipeline would never fire.
    if (agentOrchestrationEnabled && isInteractiveMode) {
      console.log('[handleTranslate] agentOrchestration on + Babel mode → auto-switching to Direct');
      setIsInteractiveMode(false);
      // Defer to next tick so React state settles, then re-enter
      setTimeout(() => handleTranslate(), 0);
      return;
    }

    if (!file) {
      console.warn('[handleTranslate] file is null — aborting');
      setErrorMessage(currentLang === 'zh'
        ? '未检测到有效文件，请重新拖入或上传文档后再点击翻译。'
        : 'No valid file detected. Please re-upload your document before translating.');
      return;
    }
    if (file.size === 0) {
      setErrorMessage(currentLang === 'zh'
        ? '💡 当前处于历史记录载入状态，不具有本地原始物理文件。请在上方点击重新拖入/上传您的原始文档再开始全新翻译。'
        : '💡 Currently loaded from cache preview. The actual source file is offline. Please click above to upload your source file before starting a new translation.');
      return;
    }

    setIsTranslating(true);
    setTranslationFinished(false);
    setErrorMessage('');
    setResultPayload(null);
    setWorkspaceResults([]);

    const allFiles = files.length > 1 ? files : [files[0]];

    for (let fi = 0; fi < allFiles.length; fi++) {
      const currentFile = allFiles[fi];
      if (!currentFile || currentFile.size === 0) continue;

      setActiveIndex(fi);
      const sId = 'sess_' + Math.random().toString(36).substr(2, 9);
      setSessionId(sId);
      setProgressPercent(10);
      setStagesMessage(currentLang === 'zh'
        ? (allFiles.length > 1 ? `正在处理第 ${fi + 1}/${allFiles.length} 个文件...` : '正在连接后端引擎...')
        : (allFiles.length > 1 ? `Processing file ${fi + 1}/${allFiles.length}...` : 'Connecting to background translator...'));

 // Multi-agent orchestration is now handled entirely within the standard
 // /api/translate path via the agentPlan payload (which includes enabled=true
 // and modelProfiles). The server-side translateRunner lazily triggers
 // Planner → Executor → Reviewer in sequence for each batch.
 // The old V2 /api/orchestrator/run path is no longer launched in parallel,
 // avoiding duplicate work and race conditions on the download cache.
 if (agentOrchestrationEnabled) {
   setAgentStatus(currentLang === 'zh' ? '多智能体编排已启用（规划→执行→校对）' : 'Multi-agent orchestration enabled (Plan→Execute→Review)');
   startPollingProgress(sId, currentFile);
 } else {
   startPollingProgress(sId, currentFile);
 }

 // Wait for polling to detect completion via batchResolveRef
 const translationPromise = new Promise<boolean>((resolve) => {
 batchResolveRef.current = resolve;
 });

 const formData = new FormData();
 formData.append('file', currentFile);
 formData.append('sourceLang', sourceLang);
 formData.append('targetLang', targetLang);
 formData.append('tone', tone);
 formData.append('sessionId', sId);

 if (useCustomApi) {
 formData.append('customApiKey', customApi.apiKey);
 formData.append('customBaseUrl', customApi.baseUrl);
 formData.append('customModel', customApi.model);
 }
        formData.append('glossaryTerms', JSON.stringify(await getActiveGlossaryTerms()));

        // When agent orchestration is enabled, use the full payload (with enabled + modelProfiles)
        // so that the standard translation path also runs Planner → Executor → Reviewer.
        // When disabled, no agentPlan is sent (standard translation only).
        if (agentOrchestrationEnabled) {
          const fullPlan = buildAgentPlanPayload();
          formData.append('agentPlan', JSON.stringify(fullPlan));
          setAgentStatus(fullPlan.summary);
        }

      try {
        // Add 30s connection timeout so stuck requests surface as errors
        // instead of leaving the progress bar frozen at 0% indefinitely.
        const controller = new AbortController();
        const connectTimeout = setTimeout(() => controller.abort(), 30000);
        const response = await fetch('/api/translate', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(connectTimeout);

        if (!response.ok) {
          clearInterval(progressPollingRef.current);
          let errMsg = '';
          try {
            const errData = await response.json();
            errMsg = errData.error;
          } catch (_) {
            try {
              errMsg = await response.text();
            } catch (__) {
              errMsg = currentLang === 'zh' ? '翻译服务端错误，请检查配置参数' : 'Translation server error, check parameters';
            }
          }
          throw new Error(errMsg || (currentLang === 'zh' ? '翻译失败' : 'Translation failed'));
        }

        // Wait for polling to detect completion and handle download
        const success = await translationPromise;
        if (!success) {
          throw new Error(currentLang === 'zh' ? '翻译下载失败' : 'Translation download failed');
        }
      } catch (err: any) {
        console.error(err);
        const isAbort = err?.name === 'AbortError';
        const fallbackMessage = isAbort
          ? (currentLang === 'zh'
            ? '翻译请求超时（30秒无响应）。后端服务可能未启动或已崩溃——若使用 DMG 桌面端，请尝试重启应用。'
            : 'Translation request timed out (30s). The backend may not be running — try restarting the DMG app.')
          : (currentLang === 'zh'
            ? '请求失败。请检查服务是否已启动、端口是否可达（当前默认 7050），以及网络/接口配置是否正常。'
            : 'Request failed. Please verify that the service is running, port 7050 is reachable, and your network/provider settings are correct.');
        const message = !err?.message || err.message === 'Failed to fetch' ? fallbackMessage : err.message;
        setErrorMessage(message);
        clearInterval(progressPollingRef.current);
        if (batchResolveRef.current) {
          const resolveFn = batchResolveRef.current;
          batchResolveRef.current = null;
          resolveFn(false);
        }
      } finally {
        resetTranslationState();
      }
    } // end for loop
  };

  // Downloader triggering
  const downloadResultPayload = (payload: ResultPayload) => {
    if (payload.directDownloadBlob && payload.directDownloadName) {
      const url = window.URL.createObjectURL(payload.directDownloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payload.directDownloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }
  };

  const downloadResult = () => {
    if (!resultPayload) return;
    downloadResultPayload(resultPayload);
  };

  const appendWorkspaceResult = (item: WorkspaceResultItem) => {
    setWorkspaceResults(prev => [...prev, item]);
    setResultPayload(item.result);
    setTranslationFinished(true);
  };

  const renderWorkspaceResultCard = (item: WorkspaceResultItem, index: number) => {
    const payload = item.result;
    return (
      <div key={item.id} className="space-y-3 p-4 bg-zinc-950/25 rounded-xl border border-zinc-800/70">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
              {currentLang === 'zh' ? `结果 ${index + 1}` : `Result ${index + 1}`}
            </div>
            <h5 className="text-xs font-semibold text-zinc-200 truncate">{item.sourceFileName}</h5>
            <p className="text-[10px] text-zinc-500 mt-0.5">{item.format} • {item.targetLang}</p>
          </div>
        </div>

        {payload.directDownloadBlob && (
          <div className="p-4 bg-zinc-950/40 rounded-xl border border-zinc-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-zinc-900 rounded-lg flex items-center justify-center border border-zinc-800">
                <FileText className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h5 className="text-xs font-semibold text-zinc-300 max-w-sm line-clamp-1">{payload.directDownloadName}</h5>
                <p className="text-[10px] font-mono text-zinc-500 mt-0.5">Original Styling Reserved</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => downloadResultPayload(payload)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-2 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{t.downloadBtn}</span>
            </button>
          </div>
        )}

        {payload.pdfBase64 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 bg-zinc-950/40 rounded-xl border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-start space-x-3 mb-3">
                <FileText className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h6 className="text-xs font-semibold text-zinc-300">{t.pdfReport}</h6>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Format Restored Document</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => downloadBase64File(payload.pdfBase64!, 'application/pdf', payload.outputName || 'Translated_Report.pdf')}
                className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                <span>Download PDF</span>
              </button>
            </div>

            <div className="p-4 bg-zinc-950/40 rounded-xl border border-zinc-800 flex flex-col justify-between">
              <div className="flex items-start space-x-3 mb-3">
                <FileSpreadsheet className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <h6 className="text-xs font-semibold text-zinc-300">{t.bilingualText}</h6>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Raw Text Alignment File</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => downloadBase64File(payload.docxBase64!, 'text/plain', payload.docxName || 'Bilingual_Text.txt')}
                className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                <span>Download TXT</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const downloadBase64File = (base64Data: string, mimeType: string, filename: string) => {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
       bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    saveHistory(updated);
  };

  const clearAllHistory = () => {
    saveHistory([]);
  };

  const loadPastResult = (item: TranslationHistoryItem) => {
    if (item.fileBase64) {
      try {
        const binary = atob(item.fileBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        let mimeType = 'application/octet-stream';
        const formatLower = item.format.toLowerCase();
        if (formatLower === 'docx') {
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (formatLower === 'pptx') {
          mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        } else if (formatLower === 'epub') {
          mimeType = 'application/epub+zip';
        } else if (formatLower === 'md') {
          mimeType = 'text/markdown';
        }
        const blob = new Blob([bytes], { type: mimeType });
        const restoredFile = new File([blob], item.name, { type: mimeType });
        const dispositionName = item.name.replace(/\.[^/.]+$/, "") + `_${item.targetLang}.${formatLower}`;
        
        setResultPayload({
          directDownloadBlob: blob,
          directDownloadName: dispositionName
        });
        setFile(restoredFile);
        setTranslationFinished(true);
        setSourceLang(item.sourceLang);
        setTargetLang(item.targetLang);
        setErrorMessage('');

        // Direct Download feedback
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = dispositionName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } catch (err: any) {
        console.error("Failed to restore history blob:", err);
      }
    } else if (item.pdfBase64 || item.docxBase64) {
      setResultPayload({
        pdfBase64: item.pdfBase64,
        docxBase64: item.docxBase64,
        textContent: item.textContent,
        outputName: item.name.replace(/\.pdf$/i, `_${item.targetLang}.pdf`),
        docxName: item.name.replace(/\.pdf$/i, `_${item.targetLang}_text.txt`)
      });
      setFile(new File([], item.name));
      setTranslationFinished(true);
      setSourceLang(item.sourceLang);
      setTargetLang(item.targetLang);
      setErrorMessage('');

      // Auto trigger PDF target download if available
      if (item.pdfBase64) {
        try {
          downloadBase64File(item.pdfBase64, 'application/pdf', item.name.replace(/\.pdf$/i, `_${item.targetLang}.pdf`));
        } catch (err) {
          console.error("Auto pdf download failed:", err);
        }
      }
    }
  };

  const countTranslated = blockStatuses.filter(s => s === 'done' || s === 'edited').length;
  const countTotal = blockStatuses.length;
  const translationPercent = countTotal > 0 ? Math.round((countTranslated / countTotal) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans p-6 flex flex-col justify-between">
      {showRepackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in font-sans">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <div className="flex items-center space-x-3 text-amber-500 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">
                {currentLang === 'zh' ? '段落未完全翻译提示' : 'Incomplete Translations Warning'}
              </h3>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed mb-6">
              {currentLang === 'zh' 
                ? '检测到该文档中仍有部分文本块处于“等待翻译”或“翻译中”状态。如果现在强行重组排版，这些未翻译段落将保留为原文形式输出。是否确认打包？' 
                : 'Some text blocks are still translating or pending. If you repack now, these items will fall back to their original text. Do you want to continue?'}
            </p>
            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowRepackConfirm(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors border border-zinc-700/55"
              >
                {currentLang === 'zh' ? '返回编辑' : 'Back to Edit'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowRepackConfirm(false);
                  await handleInteractiveRepack(true);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-amber-600/10"
              >
                {currentLang === 'zh' ? '确定打包 (Output)' : 'Repack Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in font-sans">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <div className="flex items-center space-x-3 text-red-500 mb-4">
              <Trash2 className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-bold text-white">
                {currentLang === 'zh' ? '确认清空文件列表' : 'Clear File List'}
              </h3>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed mb-6">
              {currentLang === 'zh' 
                ? `当前文件列表中有 ${files.length} 个文档。清空后当前文件列表及翻译状态将全部丢失，确定要清空吗？`
                : `There are ${files.length} files in the queue. Clearing will discard all files and translation state. Are you sure?`}
            </p>
            <div className="flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors border border-zinc-700/55"
              >
                {currentLang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={confirmClearFiles}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-lg shadow-red-600/10"
              >
                {currentLang === 'zh' ? '确定清空' : 'Clear All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bento Grid Containers */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 flex items-center justify-center overflow-hidden">
            <img src="/assets/JoE.svg" alt="JoE" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              {t.title} <span className="text-zinc-500 font-mono text-xs font-normal">{t.version}</span>
            </h1>
            <p className="text-xs text-zinc-400">{t.subTitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto justify-between sm:justify-end">
          {/* Universal Bilingual Switcher Button */}
          <button 
            type="button"
            id="lang_switcher"
            onClick={toggleLanguage}
            className="flex items-center space-x-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg border border-zinc-800 text-xs font-medium cursor-pointer transition-all"
          >
            <Globe className="w-4 h-4 text-indigo-400" />
            <span>{currentLang === 'zh' ? 'English' : '简体中文'}</span>
          </button>

          <div className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-950 text-emerald-400 rounded-lg border border-emerald-900/50 text-xs font-medium">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
            <span>{useCustomApi ? `${customApi.model || 'API'}` : 'Gemini Ready'}</span>
          </div>

          <button 
            type="button"
            id="settings_toggle"
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer border ${showSettings ? 'bg-indigo-600/10 border-indigo-500/30 text-indigo-400' : 'bg-zinc-900 border-zinc-805 text-zinc-400'}`}
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Dynamic Workflow Mode Switcher Card */}
      {interactiveStep !== 'editing' && (
        <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div className="max-w-xl">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono">
                  {currentLang === 'zh' ? 'JoEbook 智能翻译工作流模式设定' : 'JOEBOOK INTELLIGENT TRANSLATION PIPELINE'}
                </h3>
              </div>
              <p className="text-sm font-bold text-white mt-1">
                {currentLang === 'zh' ? '选择打开自动化翻译并输出，或启用逐页预览/编辑校对平台' : 'Configure layout processing & interactive editorial workspace ahead'}
              </p>
              <p className="text-xs text-zinc-400 mt-1.5 leading-normal">
                {currentLang === 'zh' 
                  ? '一键直译将全自动处理 XML/ZIP 树并直接导出重排文档；逐页校对则让您边预览边修改，校准后再发布。' 
                  : 'Direct Mode rewrites XML assets instantly for fast downloads; Interactive Mode dissects your copy for side-by-side editing before repacking.'}
              </p>
            </div>
            
            {/* Quick Toggle switch pill */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:w-auto lg:min-w-[500px]">
              {/* Option 1: Direct Mode */}
              <button 
                type="button"
                id="switcher_direct_btn"
                onClick={() => setIsInteractiveMode(false)}
                className={`p-4 rounded-xl text-left border cursor-pointer transition-all flex items-start gap-3.5 relative group ${!isInteractiveMode ? 'bg-indigo-600/10 border-indigo-500 ring-1 ring-indigo-550/20 shadow-md' : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700'}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${!isInteractiveMode ? 'bg-indigo-900/30 border-indigo-500 text-indigo-400' : 'bg-zinc-905 border-zinc-800 text-zinc-500'}`}>
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-white block flex items-center gap-1.5">
                    ⚡ {currentLang === 'zh' ? '快速自动化直译 (Direct)' : 'Rapid Auto-Repack'}
                    {!isInteractiveMode && <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>}
                  </span>
                  <span className="text-[10px] text-zinc-400 block mt-1 leading-relaxed">
                    {currentLang === 'zh' ? '全自动保留排版，静默解析后一键导出，高速无感' : 'Direct XML rewrite. Best for solid unperturbed style exports.'}
                  </span>
                </div>
              </button>

              {/* Option 2: Interactive Mode */}
              <button 
                type="button"
                id="switcher_interactive_btn"
                onClick={() => setIsInteractiveMode(true)}
                className={`p-4 rounded-xl text-left border cursor-pointer transition-all flex items-start gap-3.5 relative group ${isInteractiveMode ? 'bg-indigo-600/10 border-indigo-500 ring-1 ring-indigo-550/20 shadow-md' : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-700'}`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${isInteractiveMode ? 'bg-indigo-900/30 border-indigo-500 text-indigo-400' : 'bg-zinc-905 border-zinc-800 text-zinc-500'}`}>
                  <Edit className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-white block flex items-center gap-1.5">
                    ✍️ 翻译逐页预览与核心校对 (Babel)
                    {isInteractiveMode && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>}
                  </span>
                  <span className="text-[10px] text-zinc-400 block mt-1 leading-relaxed">
                    {currentLang === 'zh' ? '解构多栏句对，双栏排版预览与实时编辑、替换与 AI 加润' : 'Bilingual page-by-page workbench with search & inline AI polishing.'}
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bento Grid Containers */}
      <div className="grid grid-cols-12 gap-4 flex-grow">

        {interactiveStep === 'editing' ? (
          <div className="col-span-12 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between overflow-hidden animate-fade-in min-h-[500px]">
            {/* Workspace Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-4 mb-6">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 bg-indigo-950 text-indigo-400 border border-indigo-900/40 text-[10px] font-bold rounded uppercase tracking-wider">
                    JoEbook 逐页句对校对平台 (Babel Mode)
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">
                    {interactiveFileMeta.name} ({interactiveFileMeta.type.toUpperCase()})
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white mt-1 flex items-center gap-2">
                  双栏交互式校对编辑器 <span className="text-xs font-normal text-zinc-400">({interactiveFileMeta.totalBlocks} 个文本句对)</span>
                </h2>
              </div>
              
              {/* Top Controls Action Bar */}
              <div className="flex items-center space-x-2 flex-wrap gap-y-2 font-sans">
                <button 
                  type="button"
                  onClick={() => {
                    setConfirmExit(false);
                    // Also delete local draft on explicit discard exit
                    if (file) {
                      try {
                        localStorage.removeItem(`joebook_draft_${file.name}`);
                      } catch (_) {}
                    }
                    setInteractiveStep('idle');
                    setIsInteractiveMode(false);
                    setFile(null);
                  }}
                  className="px-3.5 py-1.5 bg-zinc-950 border border-zinc-805 text-zinc-400 hover:text-red-400 hover:border-red-900/40 rounded-lg text-xs cursor-pointer hover:bg-zinc-800 transition-colors font-semibold"
                >
                  {currentLang === 'zh' ? '放弃修改并退出 (Exit)' : 'Discard & Exit'}
                </button>

                <button 
                  type="button"
                  onClick={() => {
                    if (file) {
                      try {
                        const draftObj = {
                          fileName: file.name,
                          translatedParagraphs,
                          blockStatuses,
                          activePage: activeInteractivePage,
                          timestamp: Date.now()
                        };
                        localStorage.setItem(`joebook_draft_${file.name}`, JSON.stringify(draftObj));
                        setDraftSavedBadge(true);
                        setTimeout(() => setDraftSavedBadge(false), 2000);
                      } catch (err) {
                        console.error(err);
                      }
                    }
                  }}
                  className="px-3.5 py-1.5 bg-zinc-950 border border-zinc-850 text-emerald-400 hover:text-emerald-300 hover:border-emerald-950/40 rounded-lg text-xs cursor-pointer hover:bg-zinc-800 transition-colors font-semibold flex items-center gap-1.5"
                >
                  {draftSavedBadge ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                      <span>{currentLang === 'zh' ? '草稿已成功暂存！' : 'Draft Saved!'}</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 text-emerald-400 shadow-sm" />
                      <span>{currentLang === 'zh' ? '暂存草稿 (Save Draft)' : 'Save Draft'}</span>
                    </>
                  )}
                </button>
                
                <button 
                  type="button"
                  onClick={handleInteractiveRepack}
                  disabled={isRepacking}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-45"
                >
                  {isRepacking ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>正在重组排版中...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>确认并生成对齐文档</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Auto Translation Status Banner */}
            <div className="bg-zinc-950/40 p-4 border border-zinc-805 rounded-xl mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 font-sans relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex-grow space-y-2 w-full">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-xs font-bold text-zinc-200">
                    {currentLang === 'zh' ? '📚 整档大模型 AI 自动对照翻译排版进度' : '📚 Document-wide AI Symmetrical Auto-Translation'}
                  </span>
                  {translationPercent < 100 ? (
                    <span className="text-[9px] px-1.5 py-0.5 bg-indigo-950/80 text-indigo-400 border border-indigo-900/40 rounded animate-pulse font-mono font-bold uppercase shrink-0">
                      {currentLang === 'zh' ? '自动翻译进行中...' : 'Translating...'}
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-900/40 rounded font-mono font-bold uppercase shrink-0">
                      {currentLang === 'zh' ? '整篇已全自动翻译完毕' : 'Completed'}
                    </span>
                  )}
                </div>
                
                {/* Progress Bar */}
                <div className="w-full flex items-center gap-3">
                  <div className="flex-grow bg-zinc-900 h-2.5 rounded-full overflow-hidden border border-zinc-800">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full transition-all duration-300" 
                      style={{ width: `${translationPercent}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono font-bold text-zinc-300 w-16 text-right shrink-0">
                    {countTranslated} / {countTotal} ({translationPercent}%)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 font-semibold w-full md:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const pendingIdxs = originalParagraphs
                      .map((_, idx) => idx)
                      .filter(idx => blockStatuses[idx] === 'pending' || !translatedParagraphs[idx]);
                    if (pendingIdxs.length > 0) {
                      translateAllChunksInGroups(originalParagraphs);
                    }
                  }}
                  disabled={translationPercent === 100}
                  className="w-1/2 md:w-auto px-3.5 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-bold cursor-pointer text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-all text-center"
                >
                  ⚡ {currentLang === 'zh' ? '一键补全剩余 (Sync All)' : 'Sync Remaining'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const filteredParagraphs = originalParagraphs
                      .map((original, idx) => ({ original, idx }));
                    const totalBlocks = filteredParagraphs.length;
                    const totalPages = Math.ceil(totalBlocks / ITEMS_PER_PAGE);
                    const activePage = Math.min(activeInteractivePage, Math.max(0, totalPages - 1));
                    const pagedItems = filteredParagraphs.slice(activePage * ITEMS_PER_PAGE, (activePage + 1) * ITEMS_PER_PAGE);
                    
                    translateSpecificChunks(pagedItems.map(item => item.idx));
                  }}
                  className="w-1/2 md:w-auto px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold cursor-pointer transition-all text-center"
                >
                  🔄 {currentLang === 'zh' ? '强制重译本页 (Retranslate)' : 'Retranslate'}
                </button>
              </div>
            </div>

            {/* Visual alert notifying user of an active draft loading */}
            {draftRestoredNotification && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="mt-3 p-3 bg-emerald-950/35 border border-emerald-900/40 rounded-xl flex items-center gap-2.5 text-xs text-emerald-400 font-medium"
              >
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
                <span>{draftRestoredNotification}</span>
              </motion.div>
            )}

            {/* Sub-view view toggles and Batch Find-and-Replace Row */}
            {(() => {
              // Local search logic
              const filteredParagraphs = originalParagraphs
                .map((original, idx) => ({ original, idx, translated: translatedParagraphs[idx] || '' }))
                .filter(item => {
                  const query = interactiveSearch.toLowerCase();
                  return item.original.toLowerCase().includes(query) || item.translated.toLowerCase().includes(query);
                });

              const totalBlocks = filteredParagraphs.length;
              const totalPages = Math.ceil(totalBlocks / ITEMS_PER_PAGE);
              const activePage = Math.min(activeInteractivePage, Math.max(0, totalPages - 1));
              const pagedItems = filteredParagraphs.slice(activePage * ITEMS_PER_PAGE, (activePage + 1) * ITEMS_PER_PAGE);

              return (
                <>
                  {/* Mode Tabs and Bulk Find/Replace Container */}
                  <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80 mb-6 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Active Preview Mode Switcher */}
                      <div className="flex bg-zinc-900 p-1 rounded-xl border border-zinc-800 select-none">
                        <button
                          type="button"
                          onClick={() => setWorkspaceSubView('editor')}
                          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${workspaceSubView === 'editor' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>✍️ {currentLang === 'zh' ? '双栏句对对照精校' : 'Splitscreen Editor'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWorkspaceSubView('preview')}
                          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${workspaceSubView === 'preview' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>📖 {currentLang === 'zh' ? '全版式双语精美预览' : 'Live Document Preview'}</span>
                        </button>
                      </div>

                      {/* Search Indicator */}
                      <div className="relative w-full md:w-72">
                        <Search className="absolute left-2.5 top-2 ml-0.5 mt-0.5 w-3.5 h-3.5 text-zinc-500" />
                        <input 
                          type="text"
                          placeholder={currentLang === 'zh' ? '搜索包含特定词汇的句对...' : 'Filter sentence pairs...'}
                          value={interactiveSearch}
                          onChange={(e) => {
                            setInteractiveSearch(e.target.value);
                            setActiveInteractivePage(0);
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-sans"
                        />
                      </div>
                    </div>

                    {/* Find and Replace Drawer Widget */}
                    <div className="border-t border-zinc-900/60 pt-3.5 flex flex-col sm:flex-row items-center gap-3 bg-zinc-950/20 p-2.5 rounded-lg">
                      <div className="text-[11px] font-bold text-indigo-400 font-mono flex items-center gap-1.5 shrink-0 select-none">
                        <RefreshCw className="w-3 h-3 animate-spin duration-1000" />
                        <span>{currentLang === 'zh' ? '术语批量替换助手' : 'BATCH FIND & REPLACE'}</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 w-full sm:w-auto flex-grow max-w-lg">
                        <input 
                          type="text"
                          placeholder={currentLang === 'zh' ? '查找原文/译文里的词...' : 'Find lookup term...'}
                          value={findQuery}
                          onChange={(e) => setFindQuery(e.target.value)}
                          className="bg-zinc-900 text-xs border border-zinc-805 rounded px-2.5 py-1 text-white placeholder-zinc-500 font-sans focus:outline-none focus:border-indigo-500/50"
                        />
                        <input 
                          type="text"
                          placeholder={currentLang === 'zh' ? '替换为修正词...' : 'Replace with corrected...'}
                          value={replaceQuery}
                          onChange={(e) => setReplaceQuery(e.target.value)}
                          className="bg-zinc-900 text-xs border border-zinc-805 rounded px-2.5 py-1 text-white placeholder-zinc-500 font-sans focus:outline-none focus:border-indigo-500/50"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleGlobalReplace}
                        className="w-full sm:w-auto px-3.5 py-1 bg-zinc-900 border border-zinc-750 text-xs text-indigo-300 hover:text-white rounded hover:bg-indigo-650/10 hover:border-indigo-500/50 transition-all font-semibold shrink-0 cursor-pointer"
                      >
                        {currentLang === 'zh' ? '全部替换 (Replace All)' : 'Replace All'}
                      </button>
                    </div>
                  </div>

                  {/* Interactive Errors Panel */}
                  {errorMessage && (
                    <div id="interactive_error" className="mb-6 flex items-start space-x-2 text-xs text-red-400 bg-red-950/30 border border-red-900/40 p-4 rounded-xl">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="flex-grow">
                        <p className="font-bold mb-1">{currentLang === 'zh' ? '大模型翻译 / AI润色功能发生异常' : 'An error occurred during translate/polish'}:</p>
                        <p className="font-mono whitespace-pre-wrap leading-relaxed">{errorMessage}</p>
                        <p className="mt-2 text-zinc-400">
                          {currentLang === 'zh' 
                            ? '💡 快易贴士：检测到共享内置公测 API Quota 今日已满。JoEbook 支持无缝自填 API 密钥，请点击页面右上角 ⚙ 设置 按钮，开启“第三方及自建模型”，即可选择并填入您自己的 Gemini / DeepSeek / OpenAI API 密钥，直接体验 100% 畅通无阻、极致超高速的文档对齐与排版翻译功能！' 
                            : '💡 Quick Tip: The shared test key has reached its limits. JoEbook supports self-supplied keys! Click the settings gear icon in top-right to switch on "Enable Third-party / Local LLM Integration" and enter your own API Key to enjoy zero-restriction, high-speed layout-preserving document translation!'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setErrorMessage('')}
                        className="text-zinc-500 hover:text-zinc-300 ml-2 text-sm cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* SUB VIEW SWITCH CONTAINER */}
                  {workspaceSubView === 'editor' ? (
                    /* splitscreen INTERACTIVE EDITOR LAYOUT */
                    <div className="grid grid-cols-12 gap-5 flex-grow mb-6 items-stretch min-h-[480px]">
                      
                      {/* Left Side: Mock Page Layout Framework Rendering */}
                      <div className="col-span-12 lg:col-span-4 bg-zinc-950/60 border border-zinc-805 rounded-xl p-4 flex flex-col justify-between font-sans">
                        <div>
                          <div className="flex justify-between items-center border-b border-zinc-900 pb-2.5 mb-3 select-none">
                            <h4 className="text-xs font-bold text-zinc-300 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                              {currentLang === 'zh' ? '原文档版式实时看板' : 'Live Source Template Layout'}
                            </h4>
                            <span className="text-[10px] bg-zinc-900 text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded font-mono uppercase">
                              {interactiveFileMeta.type} - page {activePage + 1}
                            </span>
                          </div>

                          <p className="text-[10px] text-zinc-500 italic leading-relaxed mb-4 select-none">
                            {currentLang === 'zh' 
                              ? '下面的组件高保真模拟了您原版文件的骨架版面样式，包含了当前测试页下的文本节点段落结构：' 
                              : 'This visual panel simulates your actual layout. Hover or click structural element nodes to highlight them on the editor:'}
                          </p>

                          {/* Beautiful Page Mock Body */}
                          <div className="p-1">
                            {interactiveFileMeta.type === 'pptx' ? (
                              /* PPTX SLIDE TEMPLATE VIEW */
                              <div className="aspect-[16/9] w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 relative flex flex-col justify-between overflow-hidden shadow-xl shadow-black/30 group">
                                <div className="absolute top-0 left-0 w-12 h-6 bg-indigo-600/10 border-b border-r border-indigo-500/20 text-[8px] font-bold text-indigo-400 flex items-center justify-center rounded-tl-xl select-none">
                                  SLIDE
                                </div>
                                
                                <div className="border-b border-zinc-800 pb-2 mt-2">
                                  <div className="w-2/3 h-2 bg-indigo-500/20 rounded-md"></div>
                                </div>
                                <div className="space-y-2.5 flex-grow py-3.5">
                                  {pagedItems.map((pi, pIdx) => (
                                    <div 
                                      key={pIdx}
                                      id={`mock_para_l_${pi.idx}`}
                                      className="py-1 px-1.5 rounded bg-zinc-950/45 border border-zinc-850/50 hover:border-indigo-500/30 text-[9px] text-zinc-400 hover:text-white cursor-pointer select-none transition-all line-clamp-1 flex items-center gap-2 group-hover:scale-[1.01]"
                                    >
                                      <span className="w-1.5 h-1.5 bg-indigo-500/40 rounded-full"></span>
                                      <span>{pi.original.slice(0, 42)}...</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="text-[7.5px] text-zinc-650 font-mono flex justify-between items-center border-t border-zinc-800/30 pt-1 select-none">
                                  <span>© Presentation Layer alignment</span>
                                  <span>{activePage + 1} of {totalPages || 1}</span>
                                </div>
                              </div>
                            ) : (
                              /* DOCX / PDF / EPUB / MD STANDARD A4 SHEET VIEW */
                              <div className="aspect-[1/1.4] w-full bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-5 relative flex flex-col justify-between overflow-hidden shadow-xl shadow-black/20">
                                <div className="absolute top-0 right-0 w-14 h-4 bg-emerald-600/15 text-[8px] font-bold text-emerald-400 flex items-center justify-center rounded-bl select-none uppercase tracking-wide">
                                  A4 PAGE MOCK
                                </div>

                                <div className="space-y-3 flex-grow overflow-hidden mt-3 max-h-[290px] pr-1">
                                  {pagedItems.map((pi, pIdx) => (
                                    <div 
                                      key={pIdx}
                                      id={`mock_para_l_${pi.idx}`}
                                      className="py-2 px-2.5 rounded bg-zinc-950/60 border border-zinc-850/50 hover:border-indigo-500/30 text-[9px] text-zinc-400 hover:text-white hover:bg-zinc-900/40 hover:scale-[1.01] transition-all cursor-pointer select-all leading-normal relative group"
                                    >
                                      <div className="absolute -left-1 top-2.5 w-1 h-3 bg-zinc-700 rounded-r group-hover:bg-indigo-500"></div>
                                      <span>{pi.original.slice(0, 110)} {pi.original.length > 110 ? '...' : ''}</span>
                                    </div>
                                  ))}
                                </div>

                                <div className="text-[7.5px] border-t border-zinc-850/60 pt-2 text-zinc-600 font-mono flex justify-between select-none">
                                  <span>Document Sheet skeleton preview</span>
                                  <span>PAGE {activePage + 1}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Page Indicators inside Slide Canvas */}
                        <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-850/50 mt-4 text-xs">
                          <p className="font-bold text-[10px] text-zinc-400 uppercase tracking-widest mb-1.5 select-none">{currentLang === 'zh' ? '交互调试小提示' : 'WORKBENCH TIPS'}</p>
                          <p className="text-[10px] text-zinc-500 leading-relaxed select-none">
                            {currentLang === 'zh' 
                              ? '对右侧文本框进行任意文字修正、增删均会实时更新到内存最终排版流中。可随时点击下方下一页分页前进。' 
                              : 'Any manual corrections written on the right textareas update the repack stream immediately. Click next below to progress.'}
                          </p>
                        </div>
                      </div>

                      {/* Right Side: Translation Matcher List Editor */}
                      <div className="col-span-12 lg:col-span-8 space-y-4">
                        {pagedItems.length === 0 ? (
                          <div className="text-center py-16 text-zinc-500 text-xs font-sans bg-zinc-950/40 rounded-xl border border-zinc-850">
                            {currentLang === 'zh' ? '未检索到包含检索词的对齐句对。' : 'No matching sentence pairs found.'}
                          </div>
                        ) : (
                          pagedItems.map((item) => {
                            const status = blockStatuses[item.idx];
                            return (
                              <div 
                                key={item.idx}
                                className="bg-zinc-950/30 border border-zinc-850 rounded-xl p-4 transition-all hover:border-zinc-800 relative group font-sans"
                              >
                                <div className="flex justify-between items-center mb-3">
                                  <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800 font-mono px-2 py-0.5 rounded">
                                    {currentLang === 'zh' ? '句段段数' : 'Block'} #{item.idx + 1}
                                  </span>

                                  <div className="flex items-center space-x-1.5 text-[10px] font-semibold font-mono">
                                    {status === 'pending' && (
                                      <span className="text-zinc-500 flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 bg-zinc-600 rounded-full"></div>
                                        {currentLang === 'zh' ? '等待队列翻译...' : 'Awaiting batch...'}
                                      </span>
                                    )}
                                    {status === 'translating' && (
                                      <span className="text-amber-400 flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping"></div>
                                        {currentLang === 'zh' ? 'AI 正在书写译文...' : 'AI translating...'}
                                      </span>
                                    )}
                                    {status === 'done' && (
                                      <span className="text-emerald-500 flex items-center gap-1">
                                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                                        {currentLang === 'zh' ? 'AI 翻译完成 (可点右侧框校对)' : 'Done (Click right box to proofread)'}
                                      </span>
                                    )}
                                    {status === 'edited' && (
                                      <span className="text-indigo-400 flex items-center gap-1 font-sans">
                                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse"></div>
                                        {currentLang === 'zh' ? '✍| 已手动修正校对' : '✍| Corrected'}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {/* Left matched original */}
                                  <div className="bg-zinc-950/60 p-3 rounded-lg border border-zinc-900 select-all font-sans text-xs leading-relaxed text-zinc-305">
                                    {item.original}
                                  </div>
                                  
                                  {/* Right matched custom translation box with AI Polish pill bar */}
                                  <div className="relative flex flex-col justify-between">
                                    <textarea 
                                      value={translatedParagraphs[item.idx] || ''}
                                      disabled={status === 'pending' || status === 'translating'}
                                      placeholder={status === 'pending' || status === 'translating' ? (currentLang === 'zh' ? '等待 AI 对齐翻译渲染...' : 'Awaiting alignment completion...') : (currentLang === 'zh' ? '点击在此手动校对或美化翻译段落...' : 'Enter translation correction...')}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const oldVal = translatedParagraphsRef.current[item.idx] || '';
                                        setTranslatedParagraphs(prev => {
                                          const next = [...prev];
                                          next[item.idx] = val;
                                          return next;
                                        });
                                        setBlockStatuses(prev => {
                                          const next = [...prev];
                                          next[item.idx] = 'edited';
                                          return next;
                                        });
                                        window.setTimeout(() => learnTermsFromEdit(item.idx, oldVal, val).catch(() => {}), 0);
                                      }}
                                      rows={Math.max(2, Math.ceil(item.original.length / 50))}
                                      className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-755 focus:border-indigo-500 rounded-lg p-2.5 text-xs text-white font-sans focus:outline-none transition-all leading-relaxed resize-y disabled:opacity-40"
                                    />

                                    {/* AI inline polish helper panel */}
                                    {status !== 'pending' && status !== 'translating' && (
                                      <div className="mt-1.5 py-1 px-1.5 bg-zinc-950/60 rounded border border-zinc-905 flex items-center justify-between gap-2.5 font-mono">
                                        <div className="flex items-center space-x-1">
                                          <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse shrink-0" />
                                          <span className="text-[9px] text-zinc-400 shrink-0 select-none">AI 润色优化:</span>
                                        </div>

                                        {polishBlockIdx === item.idx && isPolishing ? (
                                          <span className="text-[9px] text-indigo-400 flex items-center font-sans">
                                            <Loader2 className="w-2.5 h-2.5 animate-spin mr-1" />
                                            {currentLang === 'zh' ? '优化润色中...' : 'Polishing...'}
                                          </span>
                                        ) : (
                                          <div className="flex items-center space-x-1.5 overflow-x-auto shrink-0 select-none">
                                            <button
                                              type="button"
                                              onClick={() => handleSingleParaPolish(item.idx, 'formal')}
                                              className="text-[8.5px] px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded border border-zinc-800 cursor-pointer"
                                              title={currentLang === 'zh' ? '使语言更加书面，严谨，正式' : 'Academically refined prose'}
                                            >
                                              🎓 {currentLang === 'zh' ? '学术化' : 'Formal'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSingleParaPolish(item.idx, 'casual')}
                                              className="text-[8.5px] px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded border border-zinc-800 cursor-pointer"
                                              title={currentLang === 'zh' ? '使语言更加口语，自然，生动' : 'Natural colloquial phrase'}
                                            >
                                              🗣️ {currentLang === 'zh' ? '口语化' : 'Colloquial'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSingleParaPolish(item.idx, 'compact')}
                                              className="text-[8.5px] px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded border border-zinc-800 cursor-pointer"
                                              title={currentLang === 'zh' ? '精简翻译字数，提炼核心' : 'Translate and compress text'}
                                            >
                                              ✂️ {currentLang === 'zh' ? '精简化' : 'Concise'}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : (
                    /* PROFESSIONAL BILINEAL RENDERING READER PREVIEW MOCKUP */
                    <div className="bg-zinc-950/80 border border-zinc-850 rounded-2xl p-6 mb-6 select-all animate-fade-in">
                      <div className="flex justify-between items-center border-b border-zinc-900 pb-3 mb-5 select-none">
                        <div>
                          <h4 className="text-xs font-bold text-white uppercase font-mono tracking-widest">
                            {currentLang === 'zh' ? '📖 双语对称排对照版面预览器' : '📖 SYMMETRICAL DUAL-COLUMN DOCUMENT READER'}
                          </h4>
                          <p className="text-[10px] text-zinc-500 mt-1">
                            {currentLang === 'zh' ? '模拟纸质对照双语装订后的完美排版，适宜快速检查翻译流畅性与位置对应性。' : 'High-fidelity dual sheet representation of the target book or paper file layout details.'}
                          </p>
                        </div>
                        <span className="text-[10px] bg-zinc-90 w bg-indigo-950 text-indigo-400 border border-indigo-900/40 px-2.5 py-1 rounded font-mono">
                          {currentLang === 'zh' ? `第 ${activePage + 1} 页对照预览` : `Page ${activePage + 1} Symmetrical View`}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start min-h-[400px]">
                        {/* Original dual book panel */}
                        <div className="bg-zinc-900/40 p-6 rounded-xl border border-zinc-850/60 shadow-lg relative min-h-[400px]">
                          <div className="absolute top-2.5 left-4 text-[8px] font-mono font-bold text-zinc-650 uppercase tracking-widest">{currentLang === 'zh' ? '左面 - 原始文本' : 'LEFT PAGE • ORIGINAL'}</div>
                          
                          <div className="space-y-4 pt-4 text-xs leading-relaxed text-zinc-400 font-sans italic">
                            {pagedItems.map((pi, idx) => (
                              <div key={idx} className="p-2 border-l border-zinc-800">
                                <span className="text-[9px] text-zinc-600 font-mono block mb-1">§ {pi.idx + 1}</span>
                                <p>{pi.original}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Translated dual book panel */}
                        <div className="bg-zinc-900/45 p-6 rounded-xl border border-zinc-850/60 shadow-lg relative min-h-[400px]">
                          <div className="absolute top-2.5 left-4 text-[8px] font-mono font-bold text-emerald-500/80 uppercase tracking-widest">{currentLang === 'zh' ? '右面 - 译后重排' : 'RIGHT PAGE • TRANSLATION'}</div>
                          
                          <div className="space-y-4 pt-4 text-xs leading-relaxed text-white font-sans">
                            {pagedItems.map((pi, idx) => (
                              <div key={idx} className="p-2 border-l border-indigo-500/30">
                                <span className="text-[9px] text-indigo-550 font-mono block mb-1">§ {pi.idx + 1}</span>
                                <p>{translatedParagraphs[pi.idx] || <span className="text-zinc-600 font-mono">({currentLang === 'zh' ? '未完待翻译...' : 'Translating...'})</span>}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Foot page bar */}
                  <div className="flex justify-between items-center border-t border-zinc-800/60 pt-4 mt-2 select-none">
                    <span className="text-[11px] text-zinc-500 font-mono hidden lg:inline">
                      Bilingual alignment locked • Every 5 sentence pairs forms a proof page.
                    </span>
                    <div className="flex items-center space-x-2 text-xs w-full sm:w-auto justify-between sm:justify-end font-sans">
                      <button 
                        type="button"
                        disabled={activePage === 0}
                        onClick={() => setActiveInteractivePage(prev => Math.max(0, prev - 1))}
                        className="px-3.5 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 rounded-lg text-xs font-semibold disabled:opacity-30 cursor-pointer text-zinc-300 transition-all"
                      >
                        {currentLang === 'zh' ? '上一页 (Prev)' : 'Prev Page'}
                      </button>
                      <button 
                        type="button"
                        disabled={activePage >= totalPages - 1}
                        onClick={() => setActiveInteractivePage(prev => Math.min(totalPages - 1, prev + 1))}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold disabled:opacity-30 cursor-pointer font-semibold transition-all"
                      >
                        {currentLang === 'zh' ? '下一页 (Next)' : 'Next Page'}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <>
            {/* BENTO CARD 1: Document Upload & File Handling Block */}
            <div className="col-span-12 lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col justify-between p-6 relative group overflow-hidden min-h-[300px]">
          <div className="absolute inset-0 bg-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
          
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
              {t.sourceFile}
            </h3>
            <span className="text-[10px] font-mono text-zinc-500 border border-zinc-800 rounded px-2 py-0.5 bg-zinc-950/40">
              {t.formatNotice}
            </span>
          </div>

          <div className="flex-grow flex flex-col justify-center">
            {files.length === 0 ? (
              <div 
                id="drop_zone"
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center ${dragActive ? 'border-indigo-500 bg-indigo-600/5' : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/20'}`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".docx,.pptx,.epub,.md,.pdf"
                  multiple
                  className="hidden" 
                />
                <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800 mb-3 shadow-indigo-600/20 shadow-md">
                  <UploadCloud className="w-5 h-5 text-indigo-400 animate-bounce" />
                </div>
                <h4 className="text-sm font-semibold text-zinc-200 mb-1">{t.dragTitle}</h4>
                <p className="text-xs text-zinc-400 max-w-md">{t.dragSub}</p>
              </div>
            ) : (
              <div className="flex flex-col space-y-3 animate-fade-in">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".docx,.pptx,.epub,.md,.pdf"
                  multiple
                  className="hidden" 
                />
                
                {/* File Queue Section Header */}
                <div className="flex justify-between items-center bg-zinc-950/20 p-2.5 rounded-xl border border-zinc-850">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    <h4 className="text-xs font-semibold text-zinc-300">
                      {currentLang === 'zh' ? `已导入文档队列 (${files.length}/10)` : `Loaded Document Queue (${files.length}/10)`}
                    </h4>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    {files.length < 10 && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 cursor-pointer bg-zinc-900/60 hover:bg-zinc-900 px-2 py-1 border border-zinc-800 rounded-lg"
                      >
                        <Plus className="w-3 h-3" />
                        {currentLang === 'zh' ? '添加' : 'Add'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={removeFile}
                      className="text-[10px] font-medium text-zinc-500 hover:text-red-400 transition-colors cursor-pointer bg-zinc-950/40 hover:bg-red-950/20 px-2 py-1 border border-zinc-800/60 rounded-lg"
                    >
                      {currentLang === 'zh' ? '清空' : 'Clear'}
                    </button>
                  </div>
                </div>

                {/* Queue Items list */}
                <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                  {files.map((f, idx) => {
                    const isActive = idx === activeIndex;
                    const suffix = f.name.split('.').pop()?.toUpperCase() || 'DOC';
                    
                    return (
                      <div
                        key={idx}
                        onClick={() => handleSwitchFile(idx)}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer relative group/item ${
                          isActive 
                            ? 'bg-indigo-950/25 border-indigo-500/80 shadow-md shadow-indigo-505/5 ring-1 ring-indigo-500/10' 
                            : 'bg-zinc-950/40 border-zinc-850 hover:border-zinc-800'
                        }`}
                      >
                        <div className="flex items-center space-x-3 truncate">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
                            isActive 
                              ? 'bg-indigo-900/40 border-indigo-800 text-indigo-400' 
                              : 'bg-zinc-900 border-zinc-800 text-zinc-500'
                          }`}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="truncate text-left">
                            <h4 className={`text-xs font-semibold truncate ${isActive ? 'text-white' : 'text-zinc-300'}`}>
                              {f.name}
                            </h4>
                            <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                              {f.size > 0 ? formatBytes(f.size) : 'Cached Run'} • {suffix}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          {isActive && (
                            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
                              {currentLang === 'zh' ? '正在处理' : 'Active'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => removeFileAt(idx, e)}
                            className="p-1.5 hover:bg-red-950/40 text-zinc-600 hover:text-red-400 rounded-md cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {errorMessage && (
              <div id="file_error" className="mt-3 flex items-start space-x-2 text-xs text-red-400 bg-red-950/20 border border-red-900/30 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800/60 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>PDF: High precision • DOCX / PPTX: Block-aligned rebuilds</span>
            <span>v2.0.0</span>
          </div>
        </div>

        {/* BENTO CARD 2: Dynamic LLM Preset Selector & Endpoint Variables Configuration Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="col-span-12 lg:col-span-4 bg-zinc-900 border border-zinc-805 rounded-2xl p-6 flex flex-col justify-between overflow-hidden"
            >
              <div>
                <div className="flex items-center justify-between mb-4 border-b border-zinc-800/60 pb-3">
                  <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-widest flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    {t.customApiTitle}
                  </h3>
                  <label className="relative inline-flex items-center cursor-pointer scale-90">
                    <input 
                      type="checkbox" 
                      id="custom_api_checkbox"
                      checked={useCustomApi}
                      onChange={(e) => setUseCustomApi(e.target.checked)}
                      className="sr-only peer" 
                    />
                    <div className="w-9 h-5 bg-zinc-950 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-500 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white"></div>
                  </label>
                </div>

                {/* API Presets Interactive Click Grid */}
                <div className="mb-4">
                  <div className="text-xs font-semibold text-zinc-400 mb-2 flex items-center justify-between">
                    <span>{t.presetSection}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {llmPresets.map((preset) => {
                      const isActive = selectedPreset === preset.id && useCustomApi;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          id={`preset_${preset.id}`}
                          onClick={() => handlePresetSelect(preset)}
                          className={`p-2 rounded-lg text-left text-[11px] border transition-all cursor-pointer ${isActive ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500/20' : 'bg-zinc-950/40 border-zinc-800 hover:border-zinc-750 text-zinc-300'}`}
                        >
                          <div className="font-semibold flex items-center justify-between">
                            <span className="truncate">{preset.id === 'gemini' ? 'Gemini' : preset.name.split(' (')[0]}</span>
                            <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-indigo-400 animate-pulse' : 'bg-zinc-700'}`} />
                          </div>
                          <p className="text-[9px] text-zinc-500 line-clamp-1 mt-0.5">
                            {currentLang === 'zh' ? preset.descriptionZh : preset.descriptionEn}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {useCustomApi && !showApiFields && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mb-4 p-3.5 bg-indigo-950/20 border border-indigo-900/40 rounded-xl flex items-center justify-between"
                  >
                    <div className="overflow-hidden space-y-0.5">
                      <div className="text-[9.5px] text-zinc-500 font-bold uppercase tracking-wider">
                        {currentLang === 'zh' ? '已启用的自定义接口' : 'Custom LLM Active'}
                      </div>
                      <div className="text-xs font-semibold text-zinc-200 truncate flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span className="font-mono text-indigo-300 font-bold">
                          {selectedPreset === 'custom' ? 'Custom' : llmPresets.find(p => p.id === selectedPreset)?.name || selectedPreset}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-medium">({customApi.model || 'Default'})</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowApiFields(true)}
                      className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[10.5px] font-bold text-indigo-400 hover:text-indigo-300 transition-all cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>{currentLang === 'zh' ? '修改配置' : 'Modify API'}</span>
                    </button>
                  </motion.div>
                )}

                <AnimatePresence>
                  {useCustomApi && showApiFields && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 bg-zinc-950/40 p-4 rounded-xl border border-zinc-800/60"
                    >
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-1">
                          {t.baseUrl}
                        </label>
                        <input 
                          type="text"
                          id="custom_api_base_url"
                          placeholder="e.g., https://api.openai.com/v1"
                          value={customApi.baseUrl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomApi((prev) => {
                              const updated = { ...prev, baseUrl: val };
                              setPresetConfigs((pc) => ({ ...pc, [selectedPreset]: updated }));
                              return updated;
                            });
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                            {t.modelName}
                          </label>
                          <button
                            type="button"
                            onClick={fetchAvailableModels}
                            disabled={isFetchingModels}
                            className="text-[9.5px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 bg-indigo-950/45 hover:bg-indigo-900/40 border border-indigo-900/40 px-2 py-0.5 rounded transition-all cursor-pointer disabled:opacity-50 select-none"
                            title={currentLang === 'zh' ? '从输入的 API 节点自动获取可用大模型列表' : 'Auto retrieve list of models in your API'}
                          >
                            {isFetchingModels ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-2.5 h-2.5" />
                            )}
                            <span>{currentLang === 'zh' ? '拉取 API 模型列表' : 'Pull API Models'}</span>
                          </button>
                        </div>
                        <input 
                          type="text"
                          id="custom_api_model"
                          placeholder="e.g., gpt-4o or qwen-plus"
                          value={customApi.model}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomApi((prev) => {
                              const updated = { ...prev, model: val };
                              setPresetConfigs((pc) => ({ ...pc, [selectedPreset]: updated }));
                              return updated;
                            });
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                        />

                        {/* Model select suggestions tag list */}
                        {fetchedModels.length > 0 && (
                          <div className="mt-2 p-2 bg-gradient-to-br from-zinc-950 to-zinc-900 rounded-lg border border-zinc-800/80 max-h-36 overflow-y-auto scrollbar-thin">
                            <p className="text-[9px] text-zinc-500 font-bold mb-1.5 uppercase tracking-wider select-none">
                              {currentLang === 'zh' ? '💡 双击或点击快速选中载入模型：' : '💡 Click to select model to use:'}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {fetchedModels.map((m) => {
                                const isSelected = customApi.model === m;
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                      setCustomApi((prev) => {
                                        const updated = { ...prev, model: m };
                                        setPresetConfigs((pc) => ({ ...pc, [selectedPreset]: updated }));
                                        return updated;
                                      });
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all border cursor-pointer select-none ${isSelected ? 'bg-indigo-600 border-indigo-500 text-white font-semibold' : 'bg-zinc-900/50 hover:bg-zinc-850/60 text-zinc-400 hover:text-zinc-200 border-zinc-800'}`}
                                  >
                                    {m}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {modelsFetchError && (
                          <div className="mt-1.5 text-[9.5px] text-amber-400 bg-amber-950/20 border border-amber-900/30 rounded p-1.5 select-none leading-normal">
                            ⚠️ {modelsFetchError}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-1">
                          {t.apiKey}
                        </label>
                        <input 
                          type="password"
                          id="custom_api_key"
                          placeholder={
                            selectedPreset === 'ollama' || selectedPreset === 'lmstudio' 
                              ? 'Not applicable for local channels' 
                              : 'Enter key...'
                          }
                          disabled={selectedPreset === 'ollama' || selectedPreset === 'lmstudio'}
                          value={customApi.apiKey}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomApi((prev) => {
                              const updated = { ...prev, apiKey: val };
                              setPresetConfigs((pc) => ({ ...pc, [selectedPreset]: updated }));
                              return updated;
                            });
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-40"
                        />
                      </div>

                      {/* Explicit Save API Configuration Button */}
                      <div className="pt-1 space-y-2">
                        <button
                          type="button"
                          id="save_settings_btn"
                          onClick={saveSettingsLocally}
                          className={`w-full py-2 px-4 rounded-lg font-semibold text-xs transition-all flex items-center justify-center space-x-2 border cursor-pointer ${settingsSavedBadge ? 'bg-emerald-950/40 border-emerald-500 text-emerald-400 font-bold' : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-600 text-white shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/20'}`}
                        >
                          {settingsSavedBadge ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-400 animate-pulse" />
                              <span>{currentLang === 'zh' ? '配置已成功保存！' : 'Configuration Saved Locally!'}</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-4 h-4 text-white/90" />
                              <span>{currentLang === 'zh' ? '保存接口配置 (Save Settings)' : 'Save API Settings'}</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={saveCurrentModelAsProfile}
                          className="w-full py-2 px-4 rounded-lg font-semibold text-xs transition-all flex items-center justify-center space-x-2 border cursor-pointer bg-emerald-700 hover:bg-emerald-600 border-emerald-600 text-white"
                        >
                          <Plus className="w-4 h-4" />
                          <span>{currentLang === 'zh' ? '保存为模型档案' : 'Save as Model Profile'}</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>


              </div>
              <div className="mt-4 border-t border-zinc-800/40 pt-3 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  <span>{currentLang === 'zh' ? '已保存模型档案' : 'Saved Model Profiles'}</span>
                  <span>{modelProfiles.length}</span>
                </div>
                {profileNotice && <p className="text-[10px] text-emerald-400">{profileNotice}</p>}
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {modelProfiles.length === 0 ? (
                    <p className="text-[10px] text-zinc-500">{currentLang === 'zh' ? '暂无模型档案。请填写 API 后点击“保存为模型档案”。' : 'No profiles yet. Fill API fields and save as profile.'}</p>
                  ) : modelProfiles.map(profile => (
                    <div key={profile.id} className="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[10px] flex items-center justify-between gap-2">
                      <button type="button" onClick={() => applyProfileAsCurrentModel(profile)} className="text-left min-w-0 flex-1">
                        <div className="font-bold text-zinc-200 truncate">{profile.name}</div>
                        <div className="text-zinc-500 truncate font-mono">{profile.model}</div>
                      </button>
                      <button type="button" onClick={() => deleteModelProfile(profile.id)} className="text-red-400 hover:text-red-300 px-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-500 pt-1">{t.presetInfo}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="col-span-12 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-2 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              {currentLang === 'zh' ? '翻译术语记忆库' : 'Translation Termbase Memory'}
            </h3>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3 space-y-3">
<div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input type="checkbox" checked={termbaseEnabled} onChange={(e) => setTermbaseEnabled(e.target.checked)} />
                  <span>{currentLang === 'zh' ? '\u542f\u7528\u672f\u8bed\u8bb0\u5fc6' : 'Enable termbase memory'}</span>
                </label>
                <button type="button" onClick={() => setShowTermbaseLibrary(v => !v)} className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-200">
                  {showTermbaseLibrary ? (currentLang === 'zh' ? '\u6536\u8d77\u672f\u8bed\u5e93' : 'Close Library') : (currentLang === 'zh' ? '\u6253\u5f00\u672f\u8bed\u5e93' : 'Open Library')}
                </button>
              </div>
{/* Custom add row - table inline form */}
<div className="border border-dashed border-zinc-700 rounded-lg p-2">
<div className="grid grid-cols-12 gap-2 items-center text-[10px]">
<span className="col-span-3 font-semibold text-zinc-400">{currentLang === 'zh' ? '原文术语' : 'Source'}</span>
<span className="col-span-1 font-semibold text-zinc-400">{currentLang === 'zh' ? '源语言' : 'Lang'}</span>
<span className="col-span-3 font-semibold text-zinc-400">{currentLang === 'zh' ? '译文术语' : 'Target'}</span>
<span className="col-span-1 font-semibold text-zinc-400">{currentLang === 'zh' ? '目标语言' : 'TgtL'}</span>
<span className="col-span-1 font-semibold text-zinc-400">{currentLang === 'zh' ? '领域' : 'Domain'}</span>
<span className="col-span-3"></span>
</div>
<div className="grid grid-cols-12 gap-1.5 items-center mt-1.5">
<input
placeholder={currentLang === 'zh' ? '输入原文...' : 'Source term...'}
className="col-span-3 bg-zinc-950/80 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600"
id="term-add-source"
onInput={(e: React.FormEvent<HTMLInputElement>) => {
const val = (e.target as HTMLInputElement).value;
const langEl = document.getElementById('term-add-source-lang') as HTMLSelectElement;
if (langEl && langEl.value === 'Auto' && val.trim()) {
const detected = detectLanguage(val);
const displayEl = document.getElementById('term-add-source-lang-display') as HTMLSpanElement;
if (displayEl) displayEl.textContent = detected !== 'Auto' ? detected : '--';
}
}}
/>
<select
className="col-span-1 bg-zinc-950/80 border border-zinc-800 rounded-lg px-0.5 py-1.5 text-[9px] text-zinc-300"
id="term-add-source-lang"
defaultValue="Auto"
onChange={(e) => {
const displayEl = document.getElementById('term-add-source-lang-display') as HTMLSpanElement;
if (displayEl) displayEl.textContent = e.target.value === 'Auto' ? (currentLang === 'zh' ? '自动' : 'auto') : e.target.value;
}}
>
<option value="Auto">{currentLang === 'zh' ? '自动' : 'Auto'}</option>
<option value="en">en</option>
<option value="zh-CN">zh-CN</option>
<option value="zh-TW">zh-TW</option>
<option value="ja">ja</option>
<option value="ko">ko</option>
<option value="fr">fr</option>
<option value="de">de</option>
<option value="es">es</option>
<option value="ru">ru</option>
<option value="ar">ar</option>
<option value="custom">{currentLang === 'zh' ? '自定义...' : 'Custom...'}</option>
</select>
<input
placeholder={currentLang === 'zh' ? '输入译文...' : 'Target term...'}
className="col-span-3 bg-zinc-950/80 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600"
id="term-add-target"
/>
<select
className="col-span-1 bg-zinc-950/80 border border-zinc-800 rounded-lg px-0.5 py-1.5 text-[9px] text-zinc-300"
id="term-add-target-lang"
defaultValue=""
>
<option value="">{currentLang === 'zh' ? '默认' : 'Default'}</option>
<option value="en">en</option>
<option value="zh-CN">zh-CN</option>
<option value="zh-TW">zh-TW</option>
<option value="ja">ja</option>
<option value="ko">ko</option>
<option value="fr">fr</option>
<option value="de">de</option>
<option value="es">es</option>
<option value="ru">ru</option>
<option value="ar">ar</option>
</select>
<input
placeholder={currentLang === 'zh' ? '领域' : 'domain'}
className="col-span-1 bg-zinc-950/80 border border-zinc-800 rounded-lg px-1 py-1.5 text-[9px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600"
id="term-add-domain"
defaultValue="manual"
/>
<div className="col-span-3 flex gap-1 items-center">
<button type="button"
onClick={async () => {
const srcEl = document.getElementById('term-add-source') as HTMLInputElement;
const tgtEl = document.getElementById('term-add-target') as HTMLInputElement;
const langEl = document.getElementById('term-add-source-lang') as HTMLSelectElement;
const tgtLangEl = document.getElementById('term-add-target-lang') as HTMLSelectElement;
const domainEl = document.getElementById('term-add-domain') as HTMLInputElement;
const customLangEl = document.getElementById('term-add-source-lang-custom') as HTMLInputElement;
const src = (srcEl?.value || '').trim();
const tgt = (tgtEl?.value || '').trim();
if (!src || !tgt) { setTermbaseNotice(currentLang === 'zh' ? '请填写原文和译文' : 'Fill source and target'); return; }
let detectedLang = langEl.value === 'Auto' ? detectLanguage(src) : langEl.value;
if (langEl.value === 'custom' && customLangEl?.value?.trim()) detectedLang = customLangEl.value.trim();
const tgtLang = tgtLangEl?.value || targetLang;
const domain = (domainEl?.value || '').trim() || 'manual';
await addTerm({ source: src, target: tgt, sourceLang: detectedLang, targetLang: tgtLang, domain, confirmed: true });
setTermbaseEntries(await loadTermbase());
if (srcEl) srcEl.value = ''; if (tgtEl) tgtEl.value = ''; if (domainEl) domainEl.value = 'manual';
setTermbaseNotice(currentLang === 'zh' ? `已添加: ${src} => ${tgt}` : `Added: ${src} => ${tgt}`);
}}
className="flex-1 px-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold flex items-center justify-center gap-1"
><Plus className="w-3 h-3" /><span>{currentLang === 'zh' ? '添加' : 'Add'}</span></button>
<span id="term-add-source-lang-display" className="text-[9px] text-emerald-500 min-w-[28px] text-center">{currentLang === 'zh' ? '自动' : 'auto'}</span>
</div>
</div>
</div>
{/* Action bar with file import */}
<div className="flex items-center justify-between gap-2 flex-wrap">
<span className="text-[10px] text-zinc-500">{currentLang === 'zh' ? `当前记忆 ${termbaseEntries.length} 条` : `${termbaseEntries.length} terms in memory`}</span>
<div className="flex gap-2 flex-wrap">
<button type="button" onClick={handleSeedDefaultTerms} className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-semibold">
{currentLang === 'zh' ? '导入默认术语' : 'Import Defaults'}
</button>
<label className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold cursor-pointer flex items-center gap-1">
<UploadCloud className="w-3 h-3" />
{importingFile ? (currentLang === 'zh' ? '导入中...' : 'Importing...') : (currentLang === 'zh' ? '导入文件' : 'Import File')}
<input type="file" ref={fileImportRef} accept=".json,.csv,.txt,.tsv" onChange={handleFileImportTerms} className="hidden" />
</label>
<button type="button" onClick={async () => {
const csv = await (await import('./termbase')).exportTermbaseCSV();
const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a'); a.href = url; a.download = 'joebook_termbase.csv'; a.click();
URL.revokeObjectURL(url);
}} className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-semibold">
{currentLang === 'zh' ? '导出CSV' : 'Export CSV'}
</button>
<button type="button" onClick={async () => {
const json = await (await import('./termbase')).exportTermbaseJSON();
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a'); a.href = url; a.download = 'joebook_termbase.json'; a.click();
URL.revokeObjectURL(url);
}} className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-semibold">
{currentLang === 'zh' ? '导出JSON' : 'Export JSON'}
</button>
</div>
</div>
{/* Drag-and-drop import zone */}
<div
className="border-2 border-dashed border-zinc-800 hover:border-indigo-600 rounded-lg p-3 text-center transition-colors cursor-pointer"
onClick={() => fileImportRef.current?.click()}
onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('border-indigo-500', 'bg-indigo-950/20'); }}
onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-950/20'); }}
onDrop={async (e) => {
e.preventDefault(); e.stopPropagation();
e.currentTarget.classList.remove('border-indigo-500', 'bg-indigo-950/20');
const droppedFile = e.dataTransfer.files[0];
if (!droppedFile) return;
setImportingFile(true);
setTermbaseNotice('');
try {
const text = await droppedFile.text();
const ext = droppedFile.name.split('.').pop()?.toLowerCase();
let imported = 0, skipped = 0;
if (ext === 'json') {
const { importTermbaseJSON } = await import('./termbase');
const result = await importTermbaseJSON(text, true);
imported = result.imported; skipped = result.skipped;
} else if (ext === 'csv') {
const { importTermbaseCSV } = await import('./termbase');
const result = await importTermbaseCSV(text);
imported = result.imported; skipped = result.skipped;
} else {
const { parseTermComparisonText, addTerms: addT } = await import('./termbase');
const detectedSourceLang = detectLanguage(text.split(/[\n=>→]/)[0] || text.substring(0, 50));
const entries = parseTermComparisonText(text, { sourceLang: detectedSourceLang, targetLang, domain: 'imported', confirmed: true });
if (entries.length === 0) {
setTermbaseNotice(currentLang === 'zh' ? '未识别到有效术语。支持 JSON/CSV/文本格式。' : 'No valid terms detected. Supports JSON/CSV/text formats.');
setImportingFile(false); return;
}
const result = await addT(entries as any);
imported = result.imported; skipped = result.skipped;
}
const latest = await loadTermbase();
setTermbaseEntries(latest);
setTermbaseNotice(currentLang === 'zh' ? `已从文件 "${droppedFile.name}" 导入 ${imported} 条，跳过 ${skipped} 条。` : `Imported ${imported}, skipped ${skipped} from "${droppedFile.name}".`);
} catch (err: any) {
setTermbaseNotice(currentLang === 'zh' ? `导入失败: ${err.message}` : `Import failed: ${err.message}`);
} finally { setImportingFile(false); }
}}
>
<FileSpreadsheet className="w-5 h-5 mx-auto text-zinc-600 mb-1" />
<p className="text-[10px] text-zinc-500">{currentLang === 'zh' ? '拖拽文件到此处导入 (JSON / CSV / TXT / TSV)' : 'Drop file here to import (JSON / CSV / TXT / TSV)'}</p>
</div>
{/* Batch term comparison text input */}
<div className="border border-dashed border-zinc-700 rounded-lg p-2">
<p className="text-[10px] text-zinc-500 mb-1.5">{currentLang === 'zh' ? '批量输入术语对照（支持 source => target / source→target / CSV / Tab 格式，每行一条）' : 'Batch term comparison input (source => target / source→target / CSV / Tab, one per line)'}</p>
<textarea
value={termComparisonText}
onChange={(e) => setTermComparisonText(e.target.value)}
placeholder={currentLang === 'zh' ? '例如：\nAgent → 智能体\nRAG → 检索增强生成\nModel Routing → 模型路由' : 'e.g.:\nAgent → 智能体\nRAG → 检索增强生成\nModel Routing → 模型路由'}
rows={3}
className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600 resize-y font-mono"
/>
<button type="button" onClick={handleImportTermComparison} disabled={!termComparisonText.trim()} className="mt-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-semibold flex items-center gap-1.5">
<Plus className="w-3 h-3" />
{currentLang === 'zh' ? '导入术语对照' : 'Import Terms'}
</button>
</div>
 {termbaseNotice && <p className="text-[10px] text-emerald-400">{termbaseNotice}</p>}
              {showTermbaseLibrary && (
                <div className="border-t border-zinc-800 pt-3 space-y-2">
                  <input
                    value={termSearch}
                    onChange={(e) => setTermSearch(e.target.value)}
                    placeholder={currentLang === 'zh' ? '\u641c\u7d22\u672f\u8bed...' : 'Search terms...'}
                    className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-3 py-2 text-[10px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600"
                  />
 {/* Table header */}
<div className="grid grid-cols-12 gap-1 text-[9px] font-semibold text-zinc-500 uppercase tracking-wider px-1">
<span className="col-span-3">{currentLang === 'zh' ? '原文术语' : 'Source'}</span>
<span className="col-span-1">{currentLang === 'zh' ? '源语言' : 'SrcL'}</span>
<span className="col-span-3">{currentLang === 'zh' ? '译文术语' : 'Target'}</span>
<span className="col-span-1">{currentLang === 'zh' ? '目标语言' : 'TgtL'}</span>
<span className="col-span-1 text-center">{currentLang === 'zh' ? '频次' : 'Freq'}</span>
<span className="col-span-2 text-center">{currentLang === 'zh' ? '领域/状态' : 'Domain/Status'}</span>
<span className="col-span-1"></span>
</div>
<div className="max-h-80 overflow-y-auto space-y-1">
{termbaseEntries
.filter(term => !termSearch || `${term.source} ${term.target} ${term.domain}`.toLowerCase().includes(termSearch.toLowerCase()))
.slice(0, 300)
.map(term => (
<div key={term.id} className="grid grid-cols-12 gap-1 items-center bg-zinc-900/70 border border-zinc-800 rounded-lg p-1.5 text-[10px] group">
<input value={term.source} onChange={(e) => handleUpdateTerm(term.id, { source: e.target.value })} className="col-span-3 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-full" />
<select
value={term.sourceLang || 'Auto'}
onChange={(e) => handleUpdateTerm(term.id, { sourceLang: e.target.value })}
className="col-span-1 bg-zinc-950 border border-zinc-800 rounded px-0.5 py-1 text-[9px] text-zinc-300"
>
<option value="Auto">Auto</option>
<option value="en">en</option>
<option value="zh-CN">zh-CN</option>
<option value="zh-TW">zh-TW</option>
<option value="ja">ja</option>
<option value="ko">ko</option>
<option value="fr">fr</option>
<option value="de">de</option>
<option value="es">es</option>
<option value="ru">ru</option>
<option value="ar">ar</option>
</select>
<input value={term.target} onChange={(e) => handleUpdateTerm(term.id, { target: e.target.value })} className="col-span-3 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 w-full" />
<select
value={term.targetLang || ''}
onChange={(e) => handleUpdateTerm(term.id, { targetLang: e.target.value })}
className="col-span-1 bg-zinc-950 border border-zinc-800 rounded px-0.5 py-1 text-[9px] text-zinc-300"
>
<option value="">{currentLang === 'zh' ? '默认' : 'Dft'}</option>
<option value="en">en</option>
<option value="zh-CN">zh-CN</option>
<option value="zh-TW">zh-TW</option>
<option value="ja">ja</option>
<option value="ko">ko</option>
<option value="fr">fr</option>
<option value="de">de</option>
<option value="es">es</option>
<option value="ru">ru</option>
<option value="ar">ar</option>
</select>
<span className="col-span-1 text-zinc-500 text-center text-[9px]">{term.frequency}</span>
<div className="col-span-2 flex flex-col items-center gap-0.5">
<span className="text-[8px] text-zinc-600 truncate max-w-full">{term.domain || '--'}</span>
<span className={"text-[9px] " + (term.confirmed ? "text-emerald-500" : "text-amber-500")}>{term.confirmed ? "\u2713" : "~"}</span>
</div>
<button type="button" onClick={() => handleDeleteTerm(term.id)} className="col-span-1 text-red-400 hover:text-red-300 flex justify-center opacity-50 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
</div>
))}
{termbaseEntries.length === 0 && (
<p className="text-[10px] text-zinc-600 text-center py-4">{currentLang === 'zh' ? '术语库为空，使用上方表格添加或导入。' : 'Termbase is empty. Add or import terms above.'}</p>
)}
</div>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-widest mb-2 flex items-center gap-2">
              <CpuIcon className="w-4 h-4 text-indigo-400" />
              {currentLang === 'zh' ? '规划-执行-校对 智能体编排' : 'Planner-Executor-Proofreader Orchestration'}
            </h3>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3 space-y-3">
              <label className="flex items-center justify-between text-xs text-zinc-300">
                <span>{currentLang === 'zh' ? '启用智能体编排' : 'Enable orchestration'}</span>
                <input type="checkbox" checked={agentOrchestrationEnabled} onChange={(e) => setAgentOrchestrationEnabled(e.target.checked)} />
              </label>
              <label className="block text-[10px] text-zinc-500 uppercase font-bold">
                {currentLang === 'zh' ? '最多执行智能体数量' : 'Max executor agents'}
                <input type="number" min={1} max={12} value={agentMaxExecutors} onChange={(e) => setAgentMaxExecutors(Number(e.target.value) || 1)} className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white" />
              </label>
              {modelProfileOptions.length === 0 && (
                <p className="text-[10px] text-amber-400 bg-amber-950/20 border border-amber-900/30 rounded p-2">
                  {currentLang === 'zh' ? '请先在模型管理中心保存至少一个模型档案，智能体将从这里引用模型。' : 'Save at least one model profile in Model Management Center first.'}
                </p>
              )}
              <div className="grid grid-cols-1 gap-2">
                {(['planner','executor','proofreader'] as AgentRole[]).map(role => (
                  <label key={role} className="block text-[10px] text-zinc-500 uppercase font-bold">
                    {role === 'planner' ? (currentLang === 'zh' ? '规划智能体模型' : 'Planner Model') : role === 'executor' ? (currentLang === 'zh' ? '执行智能体模型' : 'Executor Model') : (currentLang === 'zh' ? '校对智能体模型' : 'Proofreader Model')}
                    <select
                      value={agentRoleProfileIds[role] || ''}
                      onChange={(e) => setAgentRoleProfileIds(prev => ({ ...prev, [role]: e.target.value }))}
                      className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs text-white"
                    >
                      <option value="">{currentLang === 'zh' ? '使用默认模型档案' : 'Use default profile'}</option>
                      {modelProfileOptions.map(profile => (
                        <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-indigo-300">{agentStatus || currentAgentPlan.summary}</p>
              <p className="text-[10px] text-zinc-500">
                {currentLang === 'zh'
                  ? `工作量估算：${currentAgentPlan.totalItems} 项；执行批次：${currentAgentPlan.executorBatches.length}`
                  : `Workload: ${currentAgentPlan.totalItems}; executor batches: ${currentAgentPlan.executorBatches.length}`}
              </p>
            </div>
          </div>
        </div>

        {/* BENTO CARD 3: Destination Languages & Style Selector */}
        <div className="col-span-12 lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-4">
              <span className="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
              {t.chooseLang}
            </h3>

            {/* Mode selection switches */}
            <div className="mb-4 bg-zinc-950/40 p-1 rounded-xl border border-zinc-800 flex">
              <button 
                type="button"
                id="mode_direct"
                onClick={() => setIsInteractiveMode(false)}
                className={`flex-1 py-1.5 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer ${!isInteractiveMode ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                ⚡ 快速直译 (Direct)
              </button>
              <button 
                type="button"
                id="mode_interactive"
                onClick={() => setIsInteractiveMode(true)}
                className={`flex-1 py-1.5 text-[10.5px] font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1 ${isInteractiveMode ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                <Edit className="w-3 h-3" />
                <span>✍️ 逐页校对 (Babel)</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1">
                  {t.sourceLangLabel}
                </label>
                <select 
                  id="source_lang_select"
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500"
                >
                  {sourceLanguages.map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1">
                  {t.targetLangLabel}
                </label>
                <select 
                  id="target_lang_select"
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500"
                >
                  {targetLanguages.map(item => (
                    <option key={item.name} value={item.name}>
                      {currentLang === 'zh' ? item.labelZh : item.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Writing Tones Selector */}
            <div className="space-y-2">
              <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1">
                {t.toneLabel}
              </label>

              <div 
                id="tone_professional"
                onClick={() => setTone('professional')}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${tone === 'professional' ? 'bg-indigo-950/40 border-indigo-500' : 'bg-zinc-950/20 border-zinc-800 hover:border-zinc-750'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-white">{t.toneProfessional}</span>
                  <div className={`w-2 h-2 rounded-full ${tone === 'professional' ? 'bg-indigo-500' : 'bg-transparent'}`} />
                </div>
                <p className="text-[10px] text-zinc-400">{t.toneProfessionalDesc}</p>
              </div>

              <div 
                id="tone_casual"
                onClick={() => setTone('casual')}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${tone === 'casual' ? 'bg-indigo-950/40 border-indigo-500' : 'bg-zinc-950/20 border-zinc-800 hover:border-zinc-750'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-white">{t.toneCasual}</span>
                  <div className={`w-2 h-2 rounded-full ${tone === 'casual' ? 'bg-indigo-500' : 'bg-transparent'}`} />
                </div>
                <p className="text-[10px] text-zinc-400">{t.toneCasualDesc}</p>
              </div>

              <div 
                id="tone_technical"
                onClick={() => setTone('technical')}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${tone === 'technical' ? 'bg-indigo-950/40 border-indigo-500' : 'bg-zinc-950/20 border-zinc-800 hover:border-zinc-750'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-white">{t.toneTechnical}</span>
                  <div className={`w-2 h-2 rounded-full ${tone === 'technical' ? 'bg-indigo-500' : 'bg-transparent'}`} />
                </div>
                <p className="text-[10px] text-zinc-400">{t.toneTechnicalDesc}</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <button 
              type="button"
              id="submit_translation"
              onClick={isInteractiveMode ? handleIntelligentParse : (files.length > 1 ? handleBatchTranslate : handleTranslate)}
              disabled={files.length === 0 || isTranslating || isBatchProcessing || interactiveStep === 'parsing'}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white font-semibold text-xs py-3 rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center space-x-2"
            >
              {isTranslating || isBatchProcessing || interactiveStep === 'parsing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isBatchProcessing 
                      ? `${currentLang === 'zh' ? `批量翻译中 (${batchCurrentIndex + 1}/${files.length})` : `Batch translating (${batchCurrentIndex + 1}/${files.length})`} • ${progressPercent || 15}%`
                      : `${progressPercent || 15}% ${stagesMessage.slice(0, 20)}...`
                    }
                  </span>
                </>
              ) : isInteractiveMode ? (
                <>
                  <Edit className="w-4 h-4 cursor-pointer" />
                  <span>{currentLang === 'zh' ? '开始分步校对 (BabelDOC)' : 'Start Interactive Proofread (Babel)'}</span>
                </>
              ) : files.length > 1 ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{currentLang === 'zh' ? `开启批量保留格式智能翻译 (${files.length}个文档)` : `Start Batch Format Translation (${files.length} Docs)`}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{currentLang === 'zh' ? '开启保留格式智能翻译' : 'Translate and Keep Format'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* BENTO CARD 4: Alignment Engine Live Workspace Output */}
        <div className="col-span-12 lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between overflow-hidden">
          <div className="flex justify-between items-center mb-4 border-b border-zinc-800 pb-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-3 bg-emerald-500 rounded-sm"></span>
              {t.workspaceTitle}
            </h3>
            {isTranslating && (
              <div className="flex items-center space-x-1">
                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                <span className="text-[10px] font-mono text-indigo-400">{progressPercent}%</span>
              </div>
            )}
          </div>

          <div className="flex-grow flex flex-col justify-center min-h-[220px]">
            {!isTranslating && !translationFinished && (
              <div id="workspace_idle" className="text-center max-w-md mx-auto py-8">
                <Terminal className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <h4 className="text-sm font-semibold text-zinc-300 mb-1">{t.waiting}</h4>
                <p className="text-xs text-zinc-500 leading-relaxed">{t.waitingDesc}</p>
              </div>
            )}

            {isTranslating && (
              <div id="workspace_running" className="max-w-md mx-auto w-full text-center py-6">
                <h4 className="text-sm font-semibold text-white mb-2 animate-pulse">{t.interpreting}</h4>
                <p className="text-xs text-zinc-400 mb-4">{stagesMessage}</p>
                
                {/* ProgressBar */}
                <div className="w-full bg-zinc-950 h-2.5 rounded-full overflow-hidden border border-zinc-800 relative shadow-inner">
                  <motion.div 
                    initial={{ width: '10%' }}
                    animate={{ width: `${progressPercent}%` }}
                    className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full"
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500 mt-2 block">{t.interpretingDesc}</span>
              </div>
            )}

            {translationFinished && workspaceResults.length > 0 && (
              <div id="workspace_success" className="animate-fade-in py-2 space-y-4">
                <div className="flex items-center space-x-3 mb-4 bg-emerald-950/20 border border-emerald-900/30 p-4 rounded-xl">
                  <div className="w-10 h-10 bg-emerald-950 rounded-full flex items-center justify-center border border-emerald-800">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{t.completedTitle}</h4>
                    <p className="text-xs text-zinc-400">{currentLang === 'zh' ? `本次共完成 ${workspaceResults.length} 个翻译文件，按完成顺序展示如下。` : `${workspaceResults.length} translated files completed in this run, shown below in completion order.`}</p>
                  </div>
                </div>

                <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                  {workspaceResults.map((item, index) => renderWorkspaceResultCard(item, index))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500">
            <span>Powered by Zip-XML Parser Engine</span>
            <span>All tasks computed locally inside secure cloud</span>
          </div>
        </div>
        </>
        )}

        {/* BENTO CARD 7: Recent Translations History Cached Register */}
        <div className="col-span-12 lg:col-span-12 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-zinc-800/60">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
                {t.historyTitle}
              </h3>
              {history.length > 0 && (
                <button 
                  type="button"
                  id="clear_all_history"
                  onClick={clearAllHistory}
                  className="text-[10px] text-red-400 hover:text-red-300 hover:underline cursor-pointer flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.clearHistory}</span>
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
              {history.length === 0 ? (
                <div id="history_empty" className="text-center py-8 text-indigo-600 text-xs">
                  {t.noHistory}
                </div>
              ) : (
                history.map((item) => (
                  <div 
                    key={item.id}
                    onClick={() => loadPastResult(item)}
                    id={`history_item_${item.id}`}
                    className={`p-3 rounded-lg border text-left flex items-center justify-between transition-all ${(item.pdfBase64 || item.fileBase64) ? 'cursor-pointer bg-zinc-950/40 hover:bg-zinc-950/80 border-zinc-800 hover:border-zinc-700' : 'bg-zinc-950/10 border-zinc-850'}`}
                  >
                    <div className="flex items-center space-x-3 text-xs min-w-0">
                      <FileText className="w-4 h-4 text-indigo-400/80 shrink-0" />
                      <div className="truncate pr-2">
                        <span className="font-semibold text-zinc-300 block truncate">{item.name}</span>
                        <span className="text-[10px] text-zinc-500 font-mono block mt-0.5">
                          {item.format} • {item.size} • {item.targetLang}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 shrink-0">
                      <span className="text-[9px] font-mono text-zinc-500">{item.timestamp}</span>
                      <button 
                        type="button"
                        id={`delete_history_${item.id}`}
                        onClick={(e) => deleteHistoryItem(item.id, e)}
                        className="p-1 hover:bg-red-950/30 text-zinc-600 hover:text-red-400 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="text-[10px] text-zinc-500 mt-4 pt-3 border-t border-zinc-800/40">
            Powered by local index registries. Cached locally for maximum data client security.
          </div>
        </div>

      </div>

      {/* Bento Footer */}
      <footer className="mt-8 border-t border-zinc-900 pt-6 flex flex-col md:flex-row justify-between items-center text-xs text-zinc-500 gap-4">
        <div className="flex items-center space-x-2">
          <span>{t.footerText}</span>
          <span>•</span>
          <span className="text-indigo-400">Apple Silicon Optimized</span>
        </div>
        
        {/* Document Preservation Guide Explainer Pop-tab */}
        <div className="flex items-center space-x-6">
          <span className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full text-[11px]">
            <Info className="w-3.5 h-3.5 text-indigo-400" />
            <strong className="text-zinc-400">{t.documentation}:</strong> {t.howItWorksText}
          </span>
        </div>
      </footer>

    </div>
  );
}
