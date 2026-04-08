"use client";

import { motion } from "framer-motion";
import { LIKERT_LABELS } from "../data/types";

interface Props {
  value: number | null;
  onChange: (value: number) => void;
  error?: string;
  note?: string;
}

export default function LikertScale({ value, onChange, error, note }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {note && (
        <p className="text-[47px] text-taupe-500 bg-ivory-warm rounded-xl px-4 py-3 border border-platinum">
          {note}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {LIKERT_LABELS.map((label, i) => {
          const score = i + 1;
          const isSelected = value === score;

          return (
            <motion.button
              key={score}
              type="button"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              onClick={() => onChange(score)}
              className={`w-full text-left px-5 py-3.5 rounded-2xl border transition-all duration-200 ${
                isSelected
                  ? "border-rose-500 bg-[var(--rose-glow)] text-noir-800"
                  : "border-platinum bg-white hover:border-taupe-400 text-charcoal"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[31px] font-medium shrink-0 transition-colors ${
                    isSelected
                      ? "bg-rose-500 text-white"
                      : "bg-ivory-warm text-taupe-500"
                  }`}
                >
                  {score}
                </div>
                <span className="text-[53px] font-light">{label}</span>
              </div>
            </motion.button>
          );
        })}
      </div>
      {error && (
        <p className="text-[31px] text-rose-600 mt-1">{error}</p>
      )}
    </div>
  );
}
