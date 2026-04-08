'use client';

import { motion } from 'framer-motion';

interface TextInputProps {
  questionId: string;
  value: unknown;
  onChange: (questionId: string, value: unknown) => void;
  placeholder?: string;
  error?: string;
}

export default function TextInput({
  questionId,
  value,
  onChange,
  placeholder,
  error,
}: TextInputProps) {
  const text = (value as string) ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => onChange(questionId, e.target.value)}
        placeholder={placeholder}
        className="w-full px-5 py-4 text-[21px] rounded-2xl border-[1.5px] border-platinum bg-white focus:border-rose-500 focus:outline-none transition-colors"
      />
      {error && (
        <p className="text-[21px] text-rose-600 mt-1 pl-1">{error}</p>
      )}
    </motion.div>
  );
}
