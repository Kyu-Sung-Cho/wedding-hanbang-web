"use client";

import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "@hanbang/shared";
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
        <h2 className="text-[22px] font-semibold text-noir-800 mb-2">
          어떤 역할이신가요?
        </h2>
        <p className="text-[14px] text-taupe-400">
          커플 연동 시 역할이 구분됩니다
        </p>
      </div>

      <aside
        role="note"
        aria-label="현재 베타 관계 역할 지원 범위"
        className="rounded-2xl border border-[#B89785]/35 bg-[#FBF8F2] px-4 py-3 text-left"
      >
        <p className="text-[13px] font-semibold leading-5 text-[#36534E]">
          현재 베타 지원 범위
        </p>
        <p className="mt-1 text-[12px] leading-5 text-[#635B51]">
          {PUBLIC_BETA_RELATIONSHIP_SCOPE.notice}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-[#635B51]">
          {PUBLIC_BETA_RELATIONSHIP_SCOPE.guidance}
        </p>
      </aside>

      <div className="grid grid-cols-2 gap-4">
        {roles.map((role) => (
          <button
            type="button"
            key={role.value}
            onClick={() => onSelect(role.value)}
            aria-pressed={selected === role.value}
            className={`p-6 rounded-2xl border-2 transition-all hover:-translate-y-0.5 text-center ${
              selected === role.value
                ? "border-rose-500 bg-rose-500/5 shadow-[0_4px_16px_rgba(121,82,82,0.15)]"
                : "border-black/[0.06] bg-white hover:border-black/[0.12]"
            }`}
          >
            <div className="text-[48px] mb-3">{role.emoji}</div>
            <div className="text-[18px] font-semibold text-noir-800 mb-1">
              {role.label}
            </div>
            <div className="text-[12px] text-taupe-400">{role.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
