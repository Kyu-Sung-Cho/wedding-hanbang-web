'use client';

import { motion } from 'framer-motion';

interface NPSProps {
  questionId: string;
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  error?: string;
}

export default function NPS({
  questionId,
  min,
  max,
  minLabel,
  maxLabel,
  value,
  onChange,
  error,
}: NPSProps) {
  const scores = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div>
      <div className="flex gap-1.5 max-sm:gap-1 justify-center flex-wrap">
        {scores.map((score, i) => {
          const isSelected = value === score;
          return (
            <motion.button
              key={score}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              type="button"
              onClick={() => onChange(questionId, score)}
              className={`w-11 h-11 max-sm:w-[calc((100%-40px)/11)] max-sm:h-10 rounded-xl border-[1.5px] flex items-center justify-center text-[21px] font-display font-semibold transition-all duration-200 ${
                isSelected
                  ? 'border-rose-500 bg-rose-500 text-white shadow-[0_2px_12px_rgba(196,150,126,0.3)]'
                  : 'border-platinum bg-white text-charcoal hover:border-rose-pale hover:bg-ivory-warm'
              }`}
            >
              {score}
            </motion.button>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 px-1">
        <span className="text-[21px] text-taupe-500">{minLabel}</span>
        <span className="text-[21px] text-taupe-500">{maxLabel}</span>
      </div>
      {error && (
        <p className="text-[21px] text-rose-600 mt-2 pl-1">{error}</p>
      )}
    </div>
  );
}
