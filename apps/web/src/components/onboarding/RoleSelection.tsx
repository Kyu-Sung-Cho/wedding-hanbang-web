"use client";

import type { UserRole } from "@/types/database.types";
import { BETA_COUPLE_ROLE_SUPPORT_COPY } from "@/constants/coupleRoleSupport";

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
    <section
      className="space-y-6"
      aria-labelledby="couple-role-heading"
      aria-describedby="couple-role-support-note"
    >
      <div className="text-center">
        <h2
          id="couple-role-heading"
          className="text-[22px] font-semibold text-noir-800 mb-2"
        >
          어떤 역할이신가요?
        </h2>
        <div
          id="couple-role-support-note"
          className="space-y-1 text-[13px] leading-relaxed text-taupe-400"
        >
          <p>{BETA_COUPLE_ROLE_SUPPORT_COPY.current}</p>
          <p>{BETA_COUPLE_ROLE_SUPPORT_COPY.planned}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {roles.map((role) => (
          <button
            key={role.value}
            type="button"
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
    </section>
  );
}
