"use client";

import { motion } from "framer-motion";

interface Props {
  sectionIndex: number;
  title: string;
  sectionNote?: string;
  exampleBox?: string;
}

export default function SectionHeader({ sectionIndex, title, sectionNote, exampleBox }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mb-8"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-noir-800 text-white text-[12px] font-medium">
          {sectionIndex + 1}
        </span>
        <h2 className="font-serif-kr text-[20px] font-normal tracking-tight text-noir-800">
          {title}
        </h2>
      </div>
      {sectionNote && (
        <p className="text-[13px] text-charcoal font-light leading-relaxed ml-10 mb-3">
          {sectionNote}
        </p>
      )}
      {exampleBox && (
        <div className="ml-10 bg-ivory-deep rounded-xl p-4 border border-platinum">
          <p className="text-[12px] text-charcoal font-light leading-relaxed">
            {exampleBox}
          </p>
        </div>
      )}
    </motion.div>
  );
}
