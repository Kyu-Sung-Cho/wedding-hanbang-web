"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { QuestionOption } from "../data/types";

interface Props {
  options: QuestionOption[];
  value: number[];
  onChange: (value: number[]) => void;
  maxSelect?: number;
  otherText?: string;
  onOtherTextChange?: (text: string) => void;
  error?: string;
}

export default function MultipleChoice({
  options,
  value,
  onChange,
  maxSelect,
  otherText,
  onOtherTextChange,
  error,
}: Props) {
  const [showOtherInput, setShowOtherInput] = useState(
    options.some((o) => o.hasTextInput && value.includes(o.value))
  );

  function handleToggle(optionValue: number) {
    const opt = options.find((o) => o.value === optionValue);

    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
      if (opt?.hasTextInput) setShowOtherInput(false);
    } else {
      if (maxSelect && value.length >= maxSelect) return;
      onChange([...value, optionValue]);
      if (opt?.hasTextInput) setShowOtherInput(true);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {maxSelect && (
        <p className="text-[47px] text-taupe-500 mb-1">
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
              <span className="text-[53px] font-light">{option.label}</span>
            </div>
          </motion.button>
        );
      })}
      {showOtherInput && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-1"
        >
          <input
            type="text"
            value={otherText || ""}
            onChange={(e) => onOtherTextChange?.(e.target.value)}
            placeholder="직접 입력해주세요"
            className="w-full px-5 py-3 rounded-xl border border-platinum bg-white text-[53px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
          />
        </motion.div>
      )}
      {error && (
        <p className="text-[31px] text-rose-600 mt-1">{error}</p>
      )}
    </div>
  );
}
