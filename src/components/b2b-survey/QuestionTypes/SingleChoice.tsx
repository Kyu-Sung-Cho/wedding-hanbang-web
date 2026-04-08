"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { QuestionOption } from "../data/types";

interface Props {
  options: QuestionOption[];
  value: number | null;
  onChange: (value: number) => void;
  otherText?: string;
  onOtherTextChange?: (text: string) => void;
  error?: string;
  reportContents?: string[];
}

export default function SingleChoice({
  options,
  value,
  onChange,
  otherText,
  onOtherTextChange,
  error,
  reportContents,
}: Props) {
  const [showOtherInput, setShowOtherInput] = useState(
    options.some((o) => o.hasTextInput && o.value === value)
  );

  function handleSelect(optionValue: number) {
    onChange(optionValue);
    const opt = options.find((o) => o.value === optionValue);
    setShowOtherInput(!!opt?.hasTextInput);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {reportContents && reportContents.length > 0 && (
        <div className="bg-ivory-warm rounded-xl p-4 mb-2 border border-platinum">
          <p className="text-[38px] text-taupe-500 font-medium mb-2">리포트에 포함되는 내용:</p>
          <ul className="flex flex-col gap-1">
            {reportContents.map((item, i) => (
              <li key={i} className="text-[25px] text-charcoal flex items-start gap-2">
                <span className="text-rose-500 mt-0.5">&#x2022;</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {options.map((option, i) => (
        <motion.button
          key={option.value}
          type="button"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.3 }}
          onClick={() => handleSelect(option.value)}
          className={`w-full text-left px-5 py-4 rounded-2xl border transition-all duration-200 ${
            value === option.value
              ? "border-rose-500 bg-[var(--rose-glow)] text-noir-800"
              : "border-platinum bg-white hover:border-taupe-400 text-charcoal"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                value === option.value ? "border-rose-500" : "border-taupe-400"
              }`}
            >
              {value === option.value && (
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              )}
            </div>
            <span className="text-[23px] font-light">{option.label}</span>
          </div>
        </motion.button>
      ))}
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
            className="w-full px-5 py-3 rounded-xl border border-platinum bg-white text-[23px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
          />
        </motion.div>
      )}
      {error && (
        <p className="text-[25px] text-rose-600 mt-1">{error}</p>
      )}
    </div>
  );
}
