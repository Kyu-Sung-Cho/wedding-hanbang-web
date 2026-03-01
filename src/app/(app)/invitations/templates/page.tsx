"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useInvitationStore } from "@/stores/invitationStore";
import type { TemplateCategory, InvitationTemplate } from "@/types/invitation.types";
import { ArrowLeft, Crown, Check } from "lucide-react";
import Link from "next/link";

const CATEGORIES: { key: TemplateCategory | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "classic", label: "클래식" },
  { key: "modern", label: "모던" },
  { key: "natural", label: "내추럴" },
  { key: "season", label: "시즌" },
  { key: "unique", label: "유니크" },
];

export default function TemplateSelectPage() {
  const router = useRouter();
  const { couple } = useAuthStore();
  const { templates, templatesLoading, loadTemplates, createInvitation } = useInvitationStore();
  const [category, setCategory] = useState<TemplateCategory | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const filtered = category === "all"
    ? templates
    : templates.filter((t) => t.category === category);

  const handleSelect = async (template: InvitationTemplate) => {
    if (!couple?.id) return;
    setSelected(template.id);
    setCreating(true);

    const invitation = await createInvitation({
      couple_id: couple.id,
      template_id: template.id,
      opening_animation: template.opening_animation,
    });

    if (invitation) {
      router.push(`/invitations/${invitation.id}/edit`);
    } else {
      setCreating(false);
      setSelected(null);
    }
  };

  return (
    <div className="max-w-[900px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/invitations"
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-ivory-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-noir-800" />
        </Link>
        <div>
          <h1 className="text-[20px] font-semibold text-noir-800">템플릿 선택</h1>
          <p className="text-[13px] text-taupe-500">마음에 드는 디자인을 선택하세요</p>
        </div>
      </div>

      {/* 카테고리 필터 */}
      <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`px-4 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
              category === cat.key
                ? "bg-noir-800 text-white"
                : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 로딩 */}
      {templatesLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 템플릿 그리드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {filtered.map((template) => (
          <button
            key={template.id}
            onClick={() => handleSelect(template)}
            disabled={creating}
            className={`relative rounded-2xl border overflow-hidden text-left transition-all hover:shadow-md ${
              selected === template.id
                ? "border-rose-500 ring-2 ring-rose-500/20"
                : "border-black/[0.06] hover:border-rose-500/30"
            } ${creating ? "opacity-60 pointer-events-none" : ""}`}
          >
            {/* 썸네일 */}
            <div
              className="aspect-[3/4] flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${template.color_palette[0]}22, ${template.color_palette[1] || "#fff"})`,
              }}
            >
              <div className="text-center p-4">
                <div
                  className="text-[18px] font-medium mb-1"
                  style={{ color: template.color_palette[0], fontFamily: template.font_pair.heading }}
                >
                  Wedding
                </div>
                <div
                  className="text-[11px]"
                  style={{ color: template.color_palette[2] || "#666", fontFamily: template.font_pair.body }}
                >
                  {template.name}
                </div>
              </div>
            </div>

            {/* 정보 */}
            <div className="p-3 bg-white">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-noir-800">{template.name}</span>
                {template.is_premium && (
                  <Crown className="w-3.5 h-3.5 text-gold" />
                )}
              </div>
              <span className="text-[11px] text-taupe-500 capitalize">{template.category}</span>
            </div>

            {/* 선택 표시 */}
            {selected === template.id && (
              <div className="absolute top-3 right-3 w-6 h-6 bg-rose-500 rounded-full flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
