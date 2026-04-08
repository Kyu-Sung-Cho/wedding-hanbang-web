"use client";

import { motion } from "framer-motion";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  error?: string;
}

export default function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  error,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-2"
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "자유롭게 적어주세요"}
        maxLength={maxLength}
        rows={4}
        className="w-full px-5 py-4 rounded-2xl border border-platinum bg-white text-[23px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400 resize-none leading-relaxed"
      />
      {maxLength && (
        <p className="text-[23px] text-taupe-400 text-right">
          {value.length}/{maxLength}
        </p>
      )}
      {error && (
        <p className="text-[21px] text-rose-600">{error}</p>
      )}
    </motion.div>
  );
}
