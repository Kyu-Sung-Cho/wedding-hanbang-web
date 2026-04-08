"use client";

import { motion } from "framer-motion";

interface Props {
  sectionIndex: number;
  title: string;
  sectionNote?: string;
  additionalNotes?: string[];
  exampleBox?: string;
}

export default function SectionHeader({ sectionIndex, title, sectionNote, additionalNotes, exampleBox }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mb-8"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-noir-800 text-white text-[47px] font-medium">
          {sectionIndex + 1}
        </span>
        <h2 className="font-serif-kr text-[31px] font-normal tracking-tight text-noir-800">
          {title}
        </h2>
      </div>
      {sectionNote && (
        <p className="text-[31px] text-charcoal font-light leading-relaxed ml-10 mb-3">
          {sectionNote}
        </p>
      )}
      {additionalNotes && additionalNotes.length > 0 && (
        <div className="ml-10 mb-3 flex flex-col gap-0.5">
          {additionalNotes.map((note, i) => (
            <p key={i} className="text-[27px] text-taupe-500 font-light leading-relaxed">
              {note}
            </p>
          ))}
        </div>
      )}
      {exampleBox && (
        <div className="ml-10 bg-ivory-deep rounded-xl p-4 border border-platinum">
          <p className="text-[47px] text-charcoal font-light leading-relaxed">
            {exampleBox}
          </p>
        </div>
      )}
    </motion.div>
  );
}
