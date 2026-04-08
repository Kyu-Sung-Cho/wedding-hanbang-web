'use client';

import { motion } from 'framer-motion';
import type { SubQuestion } from '../../data/questions';

interface PriceInputProps {
  questionId: string;
  subQuestions: SubQuestion[];
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  error?: string;
}

export default function PriceInput({
  questionId,
  subQuestions,
  value,
  onChange,
  error,
}: PriceInputProps) {
  const prices = (value as Record<string, number | undefined>) ?? {};

  const handleChange = (subId: string, rawValue: string) => {
    const numericStr = rawValue.replace(/[^0-9]/g, '');
    const num = numericStr ? parseInt(numericStr, 10) : undefined;
    onChange(questionId, { ...prices, [subId]: num });
  };

  const formatNumber = (num: number | undefined): string => {
    if (num === undefined) return '';
    return num.toLocaleString('ko-KR');
  };

  return (
    <div className="space-y-4">
      {subQuestions.map((sq, i) => (
        <motion.div
          key={sq.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          <label className="block text-[21px] text-noir-800 mb-2 font-medium">
            {sq.label}
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={formatNumber(prices[sq.id])}
              onChange={(e) => handleChange(sq.id, e.target.value)}
              placeholder="0"
              className="w-full px-5 py-4 pr-16 text-[21px] rounded-2xl border-[1.5px] border-platinum bg-white focus:border-rose-500 focus:outline-none transition-colors text-right font-display font-semibold"
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[21px] text-taupe-500">
              {sq.unit}
            </span>
          </div>
        </motion.div>
      ))}
      {error && (
        <p className="text-[21px] text-rose-600 mt-1 pl-1">{error}</p>
      )}
    </div>
  );
}
