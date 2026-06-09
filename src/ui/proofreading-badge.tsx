/**
 * JoEbook Proofreading Badge — Issue indicator for translated blocks.
 *
 * Displays a warning badge next to blocks with proofreading issues.
 * Supports severity-based styling and hover preview of suggestions.
 */

import React, { useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import type { ProofIssue, IssueSeverity, IssueType } from '../agents/types';

interface ProofreadingBadgeProps {
  blockId: string;
  issues: ProofIssue[];
  currentLang: 'zh' | 'en';
  onApplySuggestion?: (blockId: string, suggestion: string) => void;
}

const SEVERITY_CONFIG: Record<IssueSeverity, {
  icon: React.ElementType;
  bg: string;
  border: string;
  text: string;
  dot: string;
}> = {
  high: {
    icon: AlertCircle,
    bg: 'bg-red-950/30',
    border: 'border-red-900/50',
    text: 'text-red-400',
    dot: 'bg-red-500',
  },
  medium: {
    icon: AlertTriangle,
    bg: 'bg-amber-950/30',
    border: 'border-amber-900/50',
    text: 'text-amber-400',
    dot: 'bg-amber-500',
  },
  low: {
    icon: Info,
    bg: 'bg-blue-950/30',
    border: 'border-blue-900/50',
    text: 'text-blue-400',
    dot: 'bg-blue-500',
  },
};

const ISSUE_TYPE_LABELS: Record<IssueType, { zh: string; en: string }> = {
  term_mismatch: { zh: '术语不一致', en: 'Term Mismatch' },
  tag_lost: { zh: '标签丢失', en: 'Tag Lost' },
  semantic_drift: { zh: '语义漂移', en: 'Semantic Drift' },
  layout_overflow: { zh: '版面溢出', en: 'Layout Overflow' },
};

export default function ProofreadingBadge({
  blockId,
  issues,
  currentLang,
  onApplySuggestion,
}: ProofreadingBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (issues.length === 0) return null;

  const highestSeverity = issues.some(i => i.severity === 'high')
    ? 'high' as const
    : issues.some(i => i.severity === 'medium')
      ? 'medium' as const
      : 'low' as const;

  const config = SEVERITY_CONFIG[highestSeverity];
  const Icon = config.icon;

  return (
    <div className="relative">
      {/* Badge indicator */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${config.bg} ${config.border} border ${config.text} transition-colors hover:opacity-80`}
        title={`${issues.length} ${currentLang === 'zh' ? '个问题' : 'issues'}`}
      >
        <Icon className="w-3 h-3" />
        <span>{issues.length}</span>
        {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
      </button>

      {/* Expanded issue list */}
      {isExpanded && (
        <div className="absolute z-50 top-full right-0 mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden animate-fade-in">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              {currentLang === 'zh' ? '质检问题' : 'Issues'}
            </span>
            <span className={`text-[10px] font-bold ${config.text}`}>
              {highestSeverity.toUpperCase()}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {issues.map((issue, idx) => {
              const issueConfig = SEVERITY_CONFIG[issue.severity];
              const typeLabel = ISSUE_TYPE_LABELS[issue.type];
              return (
                <div key={idx} className="px-3 py-2 border-b border-zinc-800/50 last:border-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${issueConfig.dot}`} />
                    <span className="text-[10px] font-semibold text-zinc-300">
                      {currentLang === 'zh' ? typeLabel.zh : typeLabel.en}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-relaxed mb-1">
                    {issue.description}
                  </p>
                  {issue.suggestion && onApplySuggestion && (
                    <button
                      type="button"
                      onClick={() => onApplySuggestion(blockId, issue.suggestion)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                    >
                      {currentLang === 'zh' ? '应用建议' : 'Apply suggestion'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
