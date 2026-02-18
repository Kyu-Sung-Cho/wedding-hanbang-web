"use client";

import { motion } from "framer-motion";

import { QuestionOption } from "../data/types";

interface Props {
  options: QuestionOption[];
  value: number[];
  onChange: (value: number[]) => void;
  maxSelect?: number;
  error?: string;
}

export default function MultipleChoice({
  options,
  value,
  onChange,
  maxSelect,
  error,
}: Props) {
  function handleToggle(optionValue: number) {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      if (maxSelect && value.length >= maxSelect) return;
      onChange([...value, optionValue]);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {maxSelect && (
        <p className="text-[12px] text-taupe-500 mb-1">
          최대 {maxSelect}개 선택 ({value.length}/{maxSelect})
        </p>
      )}
      {options.map((option, i) => {
        const isSelected = value.includes(option.value);
        const isDisabled = !isSelected && !!maxSelect && value.length >= maxSelect;

        return (
          <motion.button
            key={option.value}
            type="button"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            onClick={() => handleToggle(option.value)}
            disabled={isDisabled}
            className={`w-full text-left px-5 py-4 rounded-2xl border transition-all duration-200 ${
              isSelected
                ? "border-rose-500 bg-[var(--rose-glow)] text-noir-800"
                : isDisabled
                ? "border-platinum bg-ivory-100 text-taupe-400 cursor-not-allowed"
                : "border-platinum bg-white hover:border-taupe-400 text-charcoal"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                  isSelected ? "border-rose-500 bg-rose-500" : "border-taupe-400"
                }`}
              >
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="text-[14px] font-light">{option.label}</span>
            </div>
          </motion.button>
        );
      })}
      {error && (
        <p className="text-[13px] text-rose-600 mt-1">{error}</p>
      )}
    </div>
  );
}
