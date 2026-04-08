'use client';

import { motion } from 'framer-motion';
import type { Option } from '../../data/questions';

interface SingleChoiceProps {
  questionId: string;
  options: Option[];
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  otherText?: string;
  onOtherTextChange?: (questionId: string, text: string) => void;
  error?: string;
}

export default function SingleChoice({
  questionId,
  options,
  value,
  onChange,
  otherText,
  onOtherTextChange,
  error,
}: SingleChoiceProps) {
  return (
    <div className="space-y-3">
      {options.map((option, i) => {
        const isSelected = value === option.value;
        return (
          <motion.button
            key={option.value}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            type="button"
            onClick={() => onChange(questionId, option.value)}
            className={`w-full text-left px-5 py-4 rounded-2xl border-[1.5px] transition-all duration-200 ${
              isSelected
                ? 'border-rose-500 bg-[var(--rose-glow)] shadow-[0_2px_12px_rgba(196,150,126,0.15)]'
                : 'border-platinum bg-white hover:border-rose-pale hover:bg-ivory-warm'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                  isSelected ? 'border-rose-500' : 'border-taupe-400'
                }`}
              >
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-2.5 h-2.5 rounded-full bg-rose-500"
                  />
                )}
              </div>
              <span className="text-[23px] leading-relaxed text-noir-800">
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
                  className="w-full px-4 py-2.5 text-[53px] rounded-xl border border-platinum bg-ivory-50 focus:border-rose-500 focus:outline-none transition-colors"
                />
              </motion.div>
            )}
          </motion.button>
        );
      })}
      {error && (
        <p className="text-[31px] text-rose-600 mt-1 pl-1">{error}</p>
      )}
    </div>
  );
}
