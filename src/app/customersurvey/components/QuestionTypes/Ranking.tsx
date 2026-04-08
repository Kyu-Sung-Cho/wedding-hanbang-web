'use client';

import { motion } from 'framer-motion';
import type { Option } from '../../data/questions';

interface RankingProps {
  questionId: string;
  options: Option[];
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  maxRank: number;
  error?: string;
}

export default function Ranking({
  questionId,
  options,
  value,
  onChange,
  maxRank,
  error,
}: RankingProps) {
  const ranked = Array.isArray(value) ? (value as string[]) : [];

  const handleClick = (optionValue: string) => {
    let next: string[];
    const index = ranked.indexOf(optionValue);
    if (index !== -1) {
      next = ranked.filter((v) => v !== optionValue);
    } else {
      if (ranked.length >= maxRank) return;
      next = [...ranked, optionValue];
    }
    onChange(questionId, next);
  };

  const getRank = (optionValue: string): number => {
    return ranked.indexOf(optionValue) + 1;
  };

  const isAtMax = ranked.length >= maxRank;

  return (
    <div>
      <p className="text-[21px] text-taupe-500 mb-3">
        선택한 순서대로 순위가 매겨집니다. 다시 클릭하면 해제됩니다.
      </p>
      <div className="space-y-3">
        {options.map((option, i) => {
          const rank = getRank(option.value as string);
          const isSelected = rank > 0;
          const isDisabled = !isSelected && isAtMax;
          return (
            <motion.button
              key={option.value}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              type="button"
              onClick={() => !isDisabled && handleClick(option.value as string)}
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
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[21px] font-semibold transition-colors ${
                    isSelected
                      ? 'bg-rose-500 text-white'
                      : 'bg-ivory-200 text-taupe-400'
                  }`}
                >
                  {isSelected ? rank : ''}
                </div>
                <span className="text-[21px] leading-relaxed text-noir-800">
                  {option.label}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
      {error && (
        <p className="text-[21px] text-rose-600 mt-2 pl-1">{error}</p>
      )}
    </div>
  );
}
