"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ContactField } from "../data/types";

interface Props {
  fields: ContactField[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

function validatePhone(v: string): string | null {
  if (!v) return null;
  if (!/^[\d\-]+$/.test(v)) return "숫자와 하이픈(-)만 입력해주세요.";
  return null;
}

function validateEmail(v: string): string | null {
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "올바른 이메일 형식을 입력해주세요.";
  return null;
}

export default function ContactForm({ fields, value, onChange }: Props) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  function handleFieldChange(fieldId: string, text: string, inputType?: string) {
    // 전화번호: 숫자/하이픈만 허용
    if (inputType === "tel") {
      text = text.replace(/[^\d\-]/g, "");
    }
    onChange({ ...value, [fieldId]: text });
    // 입력 중 에러 클리어
    if (fieldErrors[fieldId]) {
      setFieldErrors((prev) => ({ ...prev, [fieldId]: null }));
    }
  }

  function handleBlur(fieldId: string, inputType?: string) {
    const v = value[fieldId] || "";
    let error: string | null = null;
    if (inputType === "tel") error = validatePhone(v);
    if (inputType === "email") error = validateEmail(v);
    setFieldErrors((prev) => ({ ...prev, [fieldId]: error }));
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
          <label className="text-[31px] text-charcoal font-medium mb-1.5 block">
            {field.label}
          </label>
          <input
            type={field.inputType || "text"}
            inputMode={field.inputType === "tel" ? "tel" : field.inputType === "email" ? "email" : "text"}
            value={value[field.id] || ""}
            onChange={(e) => handleFieldChange(field.id, e.target.value, field.inputType)}
            onBlur={() => handleBlur(field.id, field.inputType)}
            placeholder={field.placeholder}
            className={`w-full px-5 py-3.5 rounded-xl border bg-white text-[53px] text-noir-800 outline-none transition-colors placeholder:text-taupe-400 ${
              fieldErrors[field.id]
                ? "border-red-400 focus:border-red-500"
                : "border-platinum focus:border-rose-500"
            }`}
          />
          {fieldErrors[field.id] && (
            <p className="text-[47px] text-red-500 mt-1">{fieldErrors[field.id]}</p>
          )}
        </motion.div>
      ))}
    </motion.div>
  );
}
