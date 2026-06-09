/**
 * JoEbook AI Assist Toolbar — Context menu and toolbar for proofreader-driven polish.
 */

import React, { useState } from 'react';
import { Sparkles, BookOpen, Type, Maximize2 } from 'lucide-react';

interface AIAssistToolbarProps {
  blockId: string;
  selectedText: string;
  currentLang: 'zh' | 'en';
  onPolish: (action: 'academic_polish' | 'native_rewrite' | 'fit_to_bbox') => void;
  isPolishing?: boolean;
}

export default function AIAssistToolbar({
  blockId,
  selectedText,
  currentLang,
  onPolish,
  isPolishing = false,
}: AIAssistToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!selectedText) return null;

  const actions = [
    {
      id: 'academic_polish' as const,
      labelZh: '学术化重写',
      labelEn: 'Academic Polish',
      icon: BookOpen,
      color: 'text-blue-400',
      hoverBg: 'hover:bg-blue-950/40',
    },
    {
      id: 'native_rewrite' as const,
      labelZh: '地道母语化',
      labelEn: 'Native Rewrite',
      icon: Type,
      color: 'text-emerald-400',
      hoverBg: 'hover:bg-emerald-950/40',
    },
    {
      id: 'fit_to_bbox' as const,
      labelZh: '适应 BBox 极限缩写',
      labelEn: 'Fit to BBox',
      icon: Maximize2,
      color: 'text-amber-400',
      hoverBg: 'hover:bg-amber-950/40',
    },
  ];

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPolishing}
        className="p-1 rounded-md text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/40 transition-colors disabled:opacity-40"
        title={currentLang === 'zh' ? 'AI 辅助润色' : 'AI Assist'}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div className="absolute z-40 top-full left-0 mt-1 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1 animate-fade-in">
          <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
            {currentLang === 'zh' ? 'AI 辅助润色' : 'AI Polish'}
          </div>
          {actions.map(action => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                onPolish(action.id);
                setIsOpen(false);
              }}
              disabled={isPolishing}
              className={`w-full px-3 py-2 flex items-center gap-2 text-xs ${action.color} ${action.hoverBg} transition-colors disabled:opacity-40`}
            >
              <action.icon className="w-3.5 h-3.5 shrink-0" />
              <span>{currentLang === 'zh' ? action.labelZh : action.labelEn}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
