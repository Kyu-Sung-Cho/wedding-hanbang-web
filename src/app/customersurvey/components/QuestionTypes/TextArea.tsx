'use client';

import { motion } from 'framer-motion';

interface TextAreaProps {
  questionId: string;
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  placeholder?: string;
  maxLength?: number;
  error?: string;
}

export default function TextArea({
  questionId,
  value,
  onChange,
  placeholder,
  maxLength,
  error,
}: TextAreaProps) {
  const text = (value as string) ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <textarea
        value={text}
        onChange={(e) => onChange(questionId, e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={4}
        className="w-full px-5 py-4 text-[23px] rounded-2xl border-[1.5px] border-platinum bg-white focus:border-rose-500 focus:outline-none transition-colors resize-none leading-relaxed"
      />
      {maxLength && (
        <p className="text-right text-[47px] text-taupe-400 mt-1">
          {text.length}/{maxLength}
        </p>
      )}
      {error && (
        <p className="text-[31px] text-rose-600 mt-1 pl-1">{error}</p>
      )}
    </motion.div>
  );
}
