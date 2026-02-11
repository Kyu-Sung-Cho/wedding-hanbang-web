"use client";

import { ButtonOption } from "@/types/chat.types";

interface ButtonOptionsProps {
  buttons: ButtonOption[];
  onSelect: (value: string) => void;
}

export default function ButtonOptions({ buttons, onSelect }: ButtonOptionsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {buttons.map((button) => (
        <button
          key={button.value}
          onClick={() => onSelect(button.label)}
          className={`rounded-xl border px-4 py-2.5 text-left transition-all hover:shadow-sm ${
            button.recommended
              ? "border-rose-500 bg-rose-glow text-rose-500"
              : "border-platinum bg-white text-noir-800 hover:border-rose-500/30"
          }`}
        >
          <span className="block text-sm font-medium">{button.label}</span>
          {button.desc && (
            <span className="block text-xs text-taupe-400 mt-0.5">
              {button.desc}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
