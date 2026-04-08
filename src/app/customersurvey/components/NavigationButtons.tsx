'use client';

import { motion } from 'framer-motion';

interface NavigationButtonsProps {
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
  isSubmitting?: boolean;
}

export default function NavigationButtons({
  onPrev,
  onNext,
  isFirst,
  isLast,
  isSubmitting,
}: NavigationButtonsProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="flex gap-3 mt-10"
    >
      {!isFirst && (
        <button
          type="button"
          onClick={onPrev}
          className="flex-1 py-4 rounded-2xl border-[1.5px] border-platinum text-[38px] font-medium text-charcoal hover:bg-ivory-warm hover:border-rose-pale transition-all duration-200"
        >
          이전
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={isSubmitting}
        className={`flex-1 py-4 rounded-2xl text-[38px] font-medium text-white transition-all duration-200 ${
          isSubmitting
            ? 'bg-taupe-400 cursor-not-allowed'
            : 'bg-noir-800 hover:bg-noir-900 hover:shadow-[0_4px_20px_rgba(13,13,15,0.2)] active:scale-[0.98]'
        } ${isFirst ? 'w-full' : ''}`}
      >
        {isSubmitting ? '제출 중...' : isLast ? '제출하기' : '다음'}
      </button>
    </motion.div>
  );
}
