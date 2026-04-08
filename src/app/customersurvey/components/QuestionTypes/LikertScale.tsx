'use client';

import { motion } from 'framer-motion';

interface LikertScaleProps {
  questionId: string;
  scale: string[];
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  error?: string;
}

export default function LikertScale({
  questionId,
  scale,
  value,
  onChange,
  error,
}: LikertScaleProps) {
  return (
    <div>
      <div className="flex gap-2 max-sm:flex-col">
        {scale.map((label, i) => {
          const point = i + 1;
          const isSelected = value === point;
          return (
            <motion.button
              key={point}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              type="button"
              onClick={() => onChange(questionId, point)}
              className={`flex-1 py-3.5 px-2 rounded-2xl border-[1.5px] text-center transition-all duration-200 max-sm:flex max-sm:items-center max-sm:gap-3 max-sm:px-4 ${
                isSelected
                  ? 'border-rose-500 bg-[var(--rose-glow)] shadow-[0_2px_12px_rgba(196,150,126,0.15)]'
                  : 'border-platinum bg-white hover:border-rose-pale hover:bg-ivory-warm'
              }`}
            >
              <span
                className={`block text-[23px] font-display font-semibold max-sm:text-[23px] ${
                  isSelected ? 'text-rose-500' : 'text-taupe-400'
                }`}
              >
                {point}
              </span>
              <span className="block text-[23px] mt-1 text-charcoal leading-tight max-sm:text-[21px] max-sm:mt-0 max-sm:text-left">
                {label}
              </span>
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
