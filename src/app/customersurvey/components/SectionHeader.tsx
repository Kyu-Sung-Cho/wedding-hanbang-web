'use client';

import { motion } from 'framer-motion';

interface SectionHeaderProps {
  title: string;
  note?: string;
  sectionNumber: number;
}

export default function SectionHeader({ title, note, sectionNumber }: SectionHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mb-8"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[23px] font-display font-semibold tracking-widest text-rose-500 uppercase">
          Section {sectionNumber}
        </span>
        <div className="h-px flex-1 bg-gradient-to-r from-rose-pale to-transparent" />
      </div>
      <h2 className="text-[clamp(22px,4vw,28px)] font-serif-kr font-medium text-noir-800">
        {title}
      </h2>
      {note && (
        <p className="mt-2 text-[23px] text-taupe-500 leading-relaxed">{note}</p>
      )}
    </motion.div>
  );
}
