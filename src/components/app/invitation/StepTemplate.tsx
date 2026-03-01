"use client";

import { useEffect } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import { Crown, Check } from "lucide-react";

export default function StepTemplate() {
  const { templates, templatesLoading, loadTemplates, current, updateCurrent } = useInvitationStore();

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  if (templatesLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-[16px] font-medium text-noir-800 mb-1">템플릿 변경</h2>
      <p className="text-[13px] text-taupe-500 mb-5">다른 디자인으로 변경할 수 있습니다. 입력한 내용은 유지됩니다.</p>

      <div className="grid grid-cols-3 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => updateCurrent({ template_id: t.id, opening_animation: t.opening_animation })}
            className={`relative rounded-xl border overflow-hidden text-left transition-all ${
              current?.template_id === t.id
                ? "border-rose-500 ring-2 ring-rose-500/20"
                : "border-black/[0.06] hover:border-rose-500/30"
            }`}
          >
            <div
              className="aspect-[3/4] flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${t.color_palette[0]}22, ${t.color_palette[1] || "#fff"})`,
              }}
            >
              <span className="text-[11px] font-medium" style={{ color: t.color_palette[0] }}>
                {t.name}
              </span>
            </div>
            <div className="p-2 bg-white flex items-center justify-between">
              <span className="text-[11px] text-noir-800 truncate">{t.name}</span>
              {t.is_premium && <Crown className="w-3 h-3 text-gold flex-shrink-0" />}
            </div>
            {current?.template_id === t.id && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-rose-500 rounded-full flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
