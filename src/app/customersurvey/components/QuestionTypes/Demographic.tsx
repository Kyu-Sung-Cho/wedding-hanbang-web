'use client';

import { motion } from 'framer-motion';
import type { SubQuestion } from '../../data/questions';

interface DemographicProps {
  questionId: string;
  subQuestions: SubQuestion[];
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  error?: string;
}

export default function Demographic({
  questionId,
  subQuestions,
  value,
  onChange,
  error,
}: DemographicProps) {
  const data = (value as Record<string, string>) ?? {};

  const handleSelect = (subId: string, selected: string) => {
    onChange(questionId, { ...data, [subId]: selected });
  };

  return (
    <div className="space-y-6">
      {subQuestions.map((sq, i) => (
        <motion.div
          key={sq.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          <label className="block text-[14px] text-noir-800 mb-3 font-medium">
            {sq.label}
          </label>
          <div className="flex gap-2 flex-wrap">
            {sq.options?.map((option) => {
              const isSelected = data[sq.id] === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleSelect(sq.id, option)}
                  className={`px-5 py-3 rounded-2xl border-[1.5px] text-[14px] transition-all duration-200 ${
                    isSelected
                      ? 'border-rose-500 bg-[var(--rose-glow)] text-noir-800 shadow-[0_2px_12px_rgba(196,150,126,0.15)]'
                      : 'border-platinum bg-white text-charcoal hover:border-rose-pale hover:bg-ivory-warm'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </motion.div>
      ))}
      {error && (
        <p className="text-[13px] text-rose-600 mt-1 pl-1">{error}</p>
      )}
    </div>
  );
}
