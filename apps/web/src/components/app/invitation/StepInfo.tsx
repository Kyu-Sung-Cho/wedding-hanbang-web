"use client";

import { useInvitationStore } from "@/stores/invitationStore";

export default function StepInfo() {
  const { current, updateCurrent } = useInvitationStore();
  if (!current) return null;

  const field = (label: string, key: keyof typeof current, placeholder: string) => (
    <div>
      <label className="block text-[12px] font-medium text-taupe-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={(current[key] as string) ?? ""}
        onChange={(e) => updateCurrent({ [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[14px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 transition-colors"
      />
    </div>
  );

  return (
    <div>
      <h2 className="text-[16px] font-medium text-noir-800 mb-1">신랑 · 신부 정보</h2>
      <p className="text-[13px] text-taupe-500 mb-6">청첩장에 표시될 양가 정보를 입력하세요.</p>

      {/* 신랑 */}
      <div className="mb-6">
        <h3 className="text-[14px] font-medium text-noir-800 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-500 text-[11px] flex items-center justify-center font-semibold">신</span>
          신랑 측
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {field("신랑 이름", "groom_name", "이름을 입력하세요")}
          {field("신랑 아버지", "groom_father", "아버지 성함")}
          {field("신랑 어머니", "groom_mother", "어머니 성함")}
        </div>
      </div>

      {/* 신부 */}
      <div>
        <h3 className="text-[14px] font-medium text-noir-800 mb-3 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-rose-50 text-rose-500 text-[11px] flex items-center justify-center font-semibold">신</span>
          신부 측
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {field("신부 이름", "bride_name", "이름을 입력하세요")}
          {field("신부 아버지", "bride_father", "아버지 성함")}
          {field("신부 어머니", "bride_mother", "어머니 성함")}
        </div>
      </div>
    </div>
  );
}
