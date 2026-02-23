"use client";

import { motion } from "framer-motion";
import { ContactField } from "../data/types";

interface Props {
  fields: ContactField[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

export default function ContactForm({ fields, value, onChange }: Props) {
  function handleFieldChange(fieldId: string, text: string) {
    onChange({ ...value, [fieldId]: text });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-3"
    >
      {fields.map((field, i) => (
        <motion.div
          key={field.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06, duration: 0.25 }}
        >
          <label className="text-[13px] text-charcoal font-medium mb-1.5 block">
            {field.label}
          </label>
          <input
            type={field.inputType || "text"}
            value={value[field.id] || ""}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className="w-full px-5 py-3.5 rounded-xl border border-platinum bg-white text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
          />
        </motion.div>
      ))}
    </motion.div>
  );
}
