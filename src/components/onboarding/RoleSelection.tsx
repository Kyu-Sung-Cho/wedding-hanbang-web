"use client";

import type { UserRole } from "@/types/database.types";

interface RoleSelectionProps {
  selected: UserRole | null;
  onSelect: (role: UserRole) => void;
}

export default function RoleSelection({ selected, onSelect }: RoleSelectionProps) {
  const roles: { value: UserRole; emoji: string; label: string; desc: string }[] = [
    {
      value: "bride",
      emoji: "👰",
      label: "신부",
      desc: "결혼을 준비하는 예비 신부입니다",
    },
    {
      value: "groom",
      emoji: "🤵",
      label: "신랑",
      desc: "결혼을 준비하는 예비 신랑입니다",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-[35px] font-semibold text-noir-800 mb-2">
          어떤 역할이신가요?
        </h2>
        <p className="text-[23px] text-taupe-400">
          커플 연동 시 역할이 구분됩니다
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {roles.map((role) => (
          <button
            key={role.value}
            onClick={() => onSelect(role.value)}
            className={`p-6 rounded-2xl border-2 transition-all hover:-translate-y-0.5 text-center ${
              selected === role.value
                ? "border-rose-500 bg-rose-500/5 shadow-[0_4px_16px_rgba(196,150,126,0.15)]"
                : "border-black/[0.06] bg-white hover:border-black/[0.12]"
            }`}
          >
            <div className="text-[60px] mb-3">{role.emoji}</div>
            <div className="text-[23px] font-semibold text-noir-800 mb-1">
              {role.label}
            </div>
            <div className="text-[38px] text-taupe-400">{role.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
