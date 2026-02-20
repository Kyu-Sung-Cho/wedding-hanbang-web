"use client";

interface SuggestionButtonsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
}

export default function SuggestionButtons({
  suggestions,
  onSelect,
  disabled = false,
}: SuggestionButtonsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 px-1 scrollbar-hide">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className="flex-shrink-0 px-4 py-2 text-xs font-medium rounded-full
            bg-white border border-black/[0.06] text-[#928980]
            hover:border-[#C4967E] hover:text-[#C4967E] hover:bg-[#C4967E]/5
            active:scale-95
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all duration-200 shadow-sm"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
