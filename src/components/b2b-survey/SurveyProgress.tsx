"use client";

import { motion } from "framer-motion";

interface Props {
  current: number;
  total: number;
}

export default function SurveyProgress({ current, total }: Props) {
  const pct = Math.round((current / total) * 100);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[47px] text-taupe-500 font-medium">
          {current} / {total}
        </span>
        <span className="text-[47px] text-taupe-500">{pct}%</span>
      </div>
      <div className="h-1.5 bg-ivory-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
