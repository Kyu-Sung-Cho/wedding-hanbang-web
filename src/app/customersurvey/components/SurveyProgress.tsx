'use client';

import { motion } from 'framer-motion';

interface SurveyProgressProps {
  current: number;
  total: number;
  progress: number;
}

export default function SurveyProgress({ current, total, progress }: SurveyProgressProps) {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[31px] text-taupe-500 font-medium">
          {current} / {total}
        </span>
        <span className="text-[31px] text-taupe-400 font-display">
          {Math.round(progress)}%
        </span>
      </div>
      <div className="w-full h-1.5 bg-ivory-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-rose-500 to-gold"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
