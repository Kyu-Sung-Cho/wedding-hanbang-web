"use client";

import { useState, useCallback } from "react";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  max?: number;
}

export default function TagInput({ tags, onChange, max = 10 }: TagInputProps) {
  const [input, setInput] = useState("");

  const addTag = useCallback(() => {
    const trimmed = input.trim().replace(/^#/, "").slice(0, 20);
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setInput("");
      return;
    }
    if (tags.length >= max) return;
    onChange([...tags, trimmed]);
    setInput("");
  }, [input, tags, onChange, max]);

  const removeTag = useCallback(
    (tag: string) => {
      onChange(tags.filter((t) => t !== tag));
    },
    [tags, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
    // 빈 입력에서 백스페이스 누르면 마지막 태그 삭제
    if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-[#928980] bg-[#FAF8F5] border border-[#F5F2ED] rounded-full"
          >
            #{tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="p-0.5 hover:text-[#C4967E] transition-colors"
              aria-label={`${tag} 태그 삭제`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {tags.length < max && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="태그 입력 후 Enter"
            maxLength={20}
            className="flex-1 px-4 py-2.5 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors"
          />
          <button
            type="button"
            onClick={addTag}
            disabled={!input.trim()}
            className="px-4 py-2.5 text-sm font-medium text-[#928980] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl hover:bg-[#F5F2ED] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            추가
          </button>
        </div>
      )}

      <p className="text-xs text-[#B5ADA3]">
        {tags.length}/{max}개 (최대 20자)
      </p>
    </div>
  );
}
