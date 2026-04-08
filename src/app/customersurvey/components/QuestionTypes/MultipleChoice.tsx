'use client';

import { motion } from 'framer-motion';
import type { Option } from '../../data/questions';

interface MultipleChoiceProps {
  questionId: string;
  options: Option[];
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  maxSelect?: number;
  otherText?: string;
  onOtherTextChange?: (questionId: string, text: string) => void;
  error?: string;
}

export default function MultipleChoice({
  questionId,
  options,
  value,
  onChange,
  maxSelect,
  otherText,
  onOtherTextChange,
  error,
}: MultipleChoiceProps) {
  const selected = Array.isArray(value) ? (value as (number | string)[]) : [];

  const toggle = (optionValue: number | string) => {
    let next: (number | string)[];
    if (selected.includes(optionValue)) {
      next = selected.filter((v) => v !== optionValue);
    } else {
      if (maxSelect && selected.length >= maxSelect) return;
      next = [...selected, optionValue];
    }
    onChange(questionId, next);
  };

  const isAtMax = maxSelect ? selected.length >= maxSelect : false;

  return (
    <div className="space-y-3">
      {options.map((option, i) => {
        const isSelected = selected.includes(option.value);
        const isDisabled = !isSelected && isAtMax;
        return (
          <motion.button
            key={option.value}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            type="button"
            onClick={() => !isDisabled && toggle(option.value)}
            className={`w-full text-left px-5 py-4 rounded-2xl border-[1.5px] transition-all duration-200 ${
              isSelected
                ? 'border-rose-500 bg-[var(--rose-glow)] shadow-[0_2px_12px_rgba(196,150,126,0.15)]'
                : isDisabled
                  ? 'border-platinum bg-ivory-100 opacity-50 cursor-not-allowed'
                  : 'border-platinum bg-white hover:border-rose-pale hover:bg-ivory-warm'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected ? 'border-rose-500 bg-rose-500' : 'border-taupe-400'
                }`}
              >
                {isSelected && (
                  <motion.svg
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                  >
                    <path
                      d="M2.5 6L5 8.5L9.5 4"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </motion.svg>
                )}
              </div>
              <span className="text-[21px] leading-relaxed text-noir-800">
                {option.label}
              </span>
            </div>
            {option.hasTextInput && isSelected && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mt-3 ml-8"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  value={otherText ?? ''}
                  onChange={(e) => onOtherTextChange?.(questionId, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  placeholder="직접 입력해 주세요"
                  className="w-full px-4 py-2.5 text-[23px] rounded-xl border border-platinum bg-ivory-50 focus:border-rose-500 focus:outline-none transition-colors"
                />
              </motion.div>
            )}
          </motion.button>
        );
      })}
      {error && (
        <p className="text-[21px] text-rose-600 mt-1 pl-1">{error}</p>
      )}
    </div>
  );
}
