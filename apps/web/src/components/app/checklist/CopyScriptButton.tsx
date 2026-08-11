"use client";

import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";

interface CopyScriptButtonProps {
  text: string;
  label: string;
}

export default function CopyScriptButton({ text, label }: CopyScriptButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#d9d1c2] bg-white px-3 py-2 text-[12px] font-semibold text-[#36534e] transition-colors hover:border-[#36534e]/45 hover:bg-[#f8f6f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e]/50"
        aria-label={`${label} 복사`}
      >
        {state === "copied" ? (
          <Check className="h-3.5 w-3.5" />
        ) : state === "error" ? (
          <TriangleAlert className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {state === "copied" ? "복사됨" : state === "error" ? "복사 실패" : "문장 복사"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied"
          ? "대화 문장을 복사했어요."
          : state === "error"
            ? "복사하지 못했어요. 문장을 직접 선택해 복사해 주세요."
            : ""}
      </span>
    </div>
  );
}
