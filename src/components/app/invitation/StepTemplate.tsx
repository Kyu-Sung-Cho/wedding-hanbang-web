"use client";

import { useEffect, useState } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import { Crown, Check } from "lucide-react";
import type { TemplateCategory } from "@/types/invitation.types";

const CATEGORIES: { value: TemplateCategory | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "classic", label: "클래식" },
  { value: "modern", label: "모던" },
  { value: "natural", label: "내추럴" },
  { value: "season", label: "시즌" },
  { value: "unique", label: "유니크" },
];

export default function StepTemplate() {
  const { templates, templatesLoading, loadTemplates, current, updateCurrent } = useInvitationStore();
  const [category, setCategory] = useState<TemplateCategory | "all">("all");

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const filtered = category === "all" ? templates : templates.filter((t) => t.category === category);

  if (templatesLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-[21px] font-medium text-noir-800 mb-1">템플릿 선택</h2>
      <p className="text-[21px] text-taupe-500 mb-4">디자인을 선택하세요. 입력한 내용은 유지됩니다.</p>

      {/* 카테고리 필터 */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={`px-3 py-1.5 rounded-full text-[21px] font-medium whitespace-nowrap transition-colors ${
              category === c.value
                ? "bg-noir-800 text-white"
                : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {filtered.map((t) => {
          const isSelected = current?.template_id === t.id;
          const heading = (t.font_pair as { heading?: string })?.heading || "serif";
          const primary = t.color_palette[0] || "#C4967E";
          const bg = t.color_palette[1] || "#FDFCFA";
          const text = t.color_palette[2] || "#1A1A1F";

          return (
            <button
              key={t.id}
              onClick={() => updateCurrent({ template_id: t.id, opening_animation: t.opening_animation })}
              className={`relative rounded-xl border overflow-hidden text-left transition-all ${
                isSelected
                  ? "border-rose-500 ring-2 ring-rose-500/20"
                  : "border-black/[0.06] hover:border-rose-500/30"
              }`}
            >
              {/* 미니 청첩장 미리보기 */}
              <div
                className="aspect-[3/4] flex flex-col items-center justify-center p-3 gap-1.5"
                style={{ background: bg }}
              >
                <span
                  className="text-[8px] tracking-[0.15em] uppercase opacity-60"
                  style={{ color: primary }}
                >
                  Wedding Invitation
                </span>
                <div
                  className="w-6 border-t opacity-30"
                  style={{ borderColor: primary }}
                />
                <span
                  className="text-[21px] font-light leading-tight text-center"
                  style={{ fontFamily: `'${heading}', serif`, color: text }}
                >
                  신랑 & 신부
                </span>
                <span
                  className="text-[7px] opacity-40 mt-0.5"
                  style={{ color: text }}
                >
                  2026. 10. 15
                </span>
                <div className="flex gap-1 mt-1">
                  {t.color_palette.slice(0, 3).map((c, i) => (
                    <span
                      key={i}
                      className="w-2.5 h-2.5 rounded-full border border-black/[0.06]"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              {/* 이름 + 카테고리 */}
              <div className="p-2 bg-white">
                <div className="flex items-center justify-between">
                  <span className="text-[21px] text-noir-800 font-medium truncate">{t.name}</span>
                  {t.is_premium && <Crown className="w-3 h-3 text-gold flex-shrink-0" />}
                </div>
                <span className="text-[21px] text-taupe-400 capitalize">{t.category}</span>
              </div>

              {/* 선택 체크 */}
              {isSelected && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-rose-500 rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
