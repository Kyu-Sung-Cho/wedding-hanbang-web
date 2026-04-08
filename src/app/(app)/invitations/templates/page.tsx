"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useInvitationStore } from "@/stores/invitationStore";
import type { TemplateCategory, InvitationTemplate } from "@/types/invitation.types";
import {
  ArrowLeft, Crown, Check, X, Eye,
  Image as ImageIcon, MapPin, ChevronDown, Send, Heart,
} from "lucide-react";
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
  const [preview, setPreview] = useState<InvitationTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const filtered = category === "all"
    ? templates
    : templates.filter((t) => t.category === category);

  const handleConfirm = async () => {
    if (!couple?.id || !preview) return;
    setCreating(true);

    const invitation = await createInvitation({
      couple_id: couple.id,
      template_id: preview.id,
      opening_animation: preview.opening_animation,
    });

    if (invitation) {
      router.push(`/invitations/${invitation.id}/edit`);
    } else {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-[955px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/invitations"
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-ivory-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-noir-800" />
        </Link>
        <div>
          <h1 className="text-[21px] font-semibold text-noir-800">템플릿 선택</h1>
          <p className="text-[21px] text-taupe-500">마음에 드는 디자인을 눌러 미리보기 하세요</p>
        </div>
      </div>

      {/* 카테고리 필터 */}
      <div className="flex gap-2 mb-6 overflow-x-auto scrollbar-hide pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`px-4 py-2 rounded-full text-[21px] font-medium whitespace-nowrap transition-colors ${
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
            onClick={() => setPreview(template)}
            className={`relative rounded-2xl border overflow-hidden text-left transition-all hover:shadow-md ${
              preview?.id === template.id
                ? "border-rose-500 ring-2 ring-rose-500/20"
                : "border-black/[0.06] hover:border-rose-500/30"
            }`}
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
                  className="text-[21px] font-medium mb-1"
                  style={{ color: template.color_palette[0], fontFamily: template.font_pair.heading }}
                >
                  Wedding
                </div>
                <div
                  className="text-[21px]"
                  style={{ color: template.color_palette[2] || "#666", fontFamily: template.font_pair.body }}
                >
                  {template.name}
                </div>
              </div>
            </div>

            {/* 정보 */}
            <div className="p-3 bg-white">
              <div className="flex items-center justify-between">
                <span className="text-[21px] font-medium text-noir-800">{template.name}</span>
                {template.is_premium && (
                  <Crown className="w-3.5 h-3.5 text-gold" />
                )}
              </div>
              <span className="text-[21px] text-taupe-500 capitalize">{template.category}</span>
            </div>

            {/* 미리보기 아이콘 */}
            <div className="absolute top-3 right-3 w-7 h-7 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Eye className="w-3.5 h-3.5 text-noir-800" />
            </div>
          </button>
        ))}
      </div>

      {/* ═══════════ 미리보기 모달 ═══════════ */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => !creating && setPreview(null)}>
          <div
            className="relative w-full max-w-[420px] max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl animate-fade-in"
            style={{ animationDuration: "0.3s" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닫기 */}
            <button
              onClick={() => !creating && setPreview(null)}
              className="absolute top-4 right-4 z-10 w-8 h-8 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-colors"
            >
              <X className="w-4 h-4 text-noir-800" />
            </button>

            {/* ── 청첩장 프리뷰 ── */}
            <div
              className="rounded-t-3xl overflow-hidden"
              style={{ background: preview.color_palette[1] || "#FDFCFA", color: preview.color_palette[2] || "#1A1A1F" }}
            >
              {/* 1. 대표 사진 플레이스홀더 */}
              <div
                className="w-full aspect-[3/4] max-h-[280px] flex flex-col items-center justify-center"
                style={{ background: `${preview.color_palette[0]}10` }}
              >
                <ImageIcon className="w-10 h-10 mb-2 opacity-20" style={{ color: preview.color_palette[0] }} />
                <p className="text-[21px] opacity-30">대표 사진</p>
              </div>

              {/* 2. 히어로: 커플 이름 + 날짜 + 장소 */}
              <div className="py-14 px-6 text-center">
                <p
                  className="text-[21px] tracking-[0.3em] uppercase mb-6 opacity-60"
                  style={{ color: preview.color_palette[0] }}
                >
                  Wedding Invitation
                </p>
                <h2
                  className="text-[38px] font-light leading-[1.6] mb-4"
                  style={{ fontFamily: `'${preview.font_pair.heading}', serif` }}
                >
                  신랑 <span className="text-[21px] opacity-40" style={{ color: preview.color_palette[0] }}>&</span> 신부
                </h2>
                <div className="w-8 h-px mx-auto mb-4 opacity-30" style={{ background: preview.color_palette[0] }} />
                <p className="text-[21px] opacity-50">2026.00.00 토요일 오후 0시</p>
                <p className="text-[21px] opacity-40 mt-1">예식장 이름</p>
              </div>

              {/* 3. 인사말 */}
              <div className="px-8 pb-10 text-center">
                <div className="flex items-center justify-center gap-3 mb-5">
                  <div className="w-8 h-px" style={{ background: preview.color_palette[0] }} />
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: preview.color_palette[0] }} />
                  <div className="w-8 h-px" style={{ background: preview.color_palette[0] }} />
                </div>
                <p
                  className="text-[21px] leading-[2] opacity-50"
                  style={{ fontFamily: `'${preview.font_pair.body}', sans-serif` }}
                >
                  서로 다른 두 사람이 만나<br />
                  하나의 길을 걷고자 합니다.<br />
                  소중한 분들을 초대합니다.
                </p>
                <div className="flex items-center justify-center gap-3 mt-5">
                  <div className="w-8 h-px" style={{ background: preview.color_palette[0] }} />
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: preview.color_palette[0] }} />
                  <div className="w-8 h-px" style={{ background: preview.color_palette[0] }} />
                </div>
              </div>

              {/* 4. 신랑신부 정보 */}
              <div className="py-8 px-6">
                <div className="flex items-center justify-center gap-8">
                  <div className="text-center flex-1">
                    <p className="text-[21px] opacity-30 mb-1.5">Groom</p>
                    <p className="text-[21px] font-light opacity-50" style={{ fontFamily: `'${preview.font_pair.heading}', serif` }}>신랑</p>
                    <p className="text-[21px] opacity-30 mt-1">아버지 · 어머니</p>
                  </div>
                  <div className="text-[21px] opacity-20" style={{ color: preview.color_palette[0] }}>♥</div>
                  <div className="text-center flex-1">
                    <p className="text-[21px] opacity-30 mb-1.5">Bride</p>
                    <p className="text-[21px] font-light opacity-50" style={{ fontFamily: `'${preview.font_pair.heading}', serif` }}>신부</p>
                    <p className="text-[21px] opacity-30 mt-1">아버지 · 어머니</p>
                  </div>
                </div>
              </div>

              {/* 5. 갤러리 */}
              <div className="px-6 pb-8">
                <p className="text-center text-[21px] tracking-[0.2em] uppercase mb-4 opacity-40" style={{ color: preview.color_palette[0] }}>
                  Gallery
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="aspect-square rounded-xl flex items-center justify-center"
                      style={{ background: `${preview.color_palette[0]}08` }}
                    >
                      <ImageIcon className="w-5 h-5 opacity-15" style={{ color: preview.color_palette[0] }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* 6. 캘린더 */}
              <div className="px-6 pb-10 text-center">
                <p className="text-[21px] tracking-[0.2em] uppercase mb-4 opacity-40" style={{ color: preview.color_palette[0] }}>
                  Calendar
                </p>
                <div className="grid grid-cols-7 gap-1 max-w-[298px] mx-auto">
                  {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                    <div key={d} className="text-[21px] opacity-30 py-1">{d}</div>
                  ))}
                  {Array.from({ length: 28 }, (_, i) => (
                    <div
                      key={i}
                      className={`text-[21px] py-1.5 rounded-full ${i === 14 ? "text-white font-bold" : "opacity-40"}`}
                      style={i === 14 ? { background: preview.color_palette[0] } : undefined}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>

              {/* 7. 오시는 길 */}
              <div className="px-6 pb-8">
                <p className="text-center text-[21px] tracking-[0.2em] uppercase mb-4 opacity-40" style={{ color: preview.color_palette[0] }}>
                  Location
                </p>
                <div className="p-4 rounded-2xl" style={{ background: `${preview.color_palette[0]}08` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="w-4 h-4 opacity-40" style={{ color: preview.color_palette[0] }} />
                    <span className="text-[21px] opacity-50">예식장 이름</span>
                  </div>
                  <p className="text-[21px] opacity-30 pl-6 mb-2">서울특별시 강남구 ...</p>
                  <div className="pl-6 mb-3">
                    <p className="text-[21px] font-medium opacity-50 mb-1" style={{ color: preview.color_palette[0] }}>오시는 길</p>
                    <p className="text-[21px] opacity-30 leading-[1.8]">
                      지하철: 0호선 역 출구<br />버스: 000번<br />자가용: 주차 가능
                    </p>
                  </div>
                  <div className="flex gap-2 pl-6">
                    <div className="px-3 py-1.5 rounded-lg text-[21px] font-medium text-white" style={{ background: preview.color_palette[0] }}>
                      지도 보기
                    </div>
                    <div className="px-3 py-1.5 rounded-lg text-[21px] font-medium border" style={{ borderColor: `${preview.color_palette[0]}40`, color: preview.color_palette[0] }}>
                      카카오맵
                    </div>
                  </div>
                </div>
              </div>

              {/* 8. RSVP */}
              <div className="px-6 pb-8">
                <p className="text-center text-[21px] tracking-[0.2em] uppercase mb-4 opacity-40" style={{ color: preview.color_palette[0] }}>
                  RSVP
                </p>
                <div className="p-4 rounded-2xl flex flex-col gap-2" style={{ background: `${preview.color_palette[0]}08` }}>
                  <div className="w-full h-9 rounded-xl bg-white border border-black/[0.04] flex items-center px-3">
                    <span className="text-[21px] opacity-25">이름</span>
                  </div>
                  <div className="w-full h-9 rounded-xl bg-white border border-black/[0.04] flex items-center px-3">
                    <span className="text-[21px] opacity-25">연락처 (선택)</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-9 rounded-xl border border-black/[0.04] flex items-center justify-center text-[21px] opacity-30 bg-white">참석합니다</div>
                    <div className="flex-1 h-9 rounded-xl border border-black/[0.04] flex items-center justify-center text-[21px] opacity-30 bg-white">불참입니다</div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-9 rounded-xl flex items-center justify-center text-[21px] opacity-40 border" style={{ borderColor: `${preview.color_palette[0]}30`, color: preview.color_palette[0] }}>신랑측</div>
                    <div className="flex-1 h-9 rounded-xl flex items-center justify-center text-[21px] opacity-40 border" style={{ borderColor: `${preview.color_palette[0]}30`, color: preview.color_palette[0] }}>신부측</div>
                  </div>
                  <div className="w-full h-10 rounded-xl text-white text-[21px] font-medium flex items-center justify-center opacity-70" style={{ background: preview.color_palette[0] }}>
                    참석 여부 전달하기
                  </div>
                </div>
              </div>

              {/* 9. 축의금 계좌 */}
              <div className="px-6 pb-8">
                <p className="text-center text-[21px] tracking-[0.2em] uppercase mb-4 opacity-40" style={{ color: preview.color_palette[0] }}>
                  축의금 계좌
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between p-3.5 rounded-xl" style={{ background: `${preview.color_palette[0]}08` }}>
                    <span className="text-[21px] opacity-50">신랑 측 계좌</span>
                    <ChevronDown className="w-4 h-4 opacity-30" />
                  </div>
                  <div className="flex items-center justify-between p-3.5 rounded-xl" style={{ background: `${preview.color_palette[0]}08` }}>
                    <span className="text-[21px] opacity-50">신부 측 계좌</span>
                    <ChevronDown className="w-4 h-4 opacity-30" />
                  </div>
                </div>
              </div>

              {/* 10. 방명록 */}
              <div className="px-6 pb-8">
                <p className="text-center text-[21px] tracking-[0.2em] uppercase mb-4 opacity-40" style={{ color: preview.color_palette[0] }}>
                  Guestbook
                </p>
                <div className="p-3 rounded-2xl" style={{ background: `${preview.color_palette[0]}08` }}>
                  <div className="flex gap-2 mb-2">
                    <div className="flex-1 h-8 rounded-lg bg-white border border-black/[0.04] flex items-center px-2.5">
                      <span className="text-[21px] opacity-20">이름</span>
                    </div>
                    <div className="w-20 h-8 rounded-lg bg-white border border-black/[0.04] flex items-center px-2.5">
                      <span className="text-[21px] opacity-20">비밀번호</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-14 rounded-lg bg-white border border-black/[0.04] flex items-start p-2.5">
                      <span className="text-[21px] opacity-20">축하 메시지</span>
                    </div>
                    <div className="self-end w-10 h-8 rounded-lg flex items-center justify-center" style={{ background: preview.color_palette[0] }}>
                      <Send className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                </div>
                <div className="mt-2 p-3 rounded-xl bg-white border border-black/[0.04]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[21px] font-medium opacity-40">홍길동</span>
                    <span className="text-[21px] opacity-20">2026.03.01</span>
                  </div>
                  <p className="text-[21px] opacity-30">결혼 진심으로 축하해요!</p>
                </div>
              </div>

              {/* 11. 공유 버튼 */}
              <div className="py-8 text-center">
                <div
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[21px] font-medium text-white opacity-70"
                  style={{ background: preview.color_palette[0] }}
                >
                  <Heart className="w-3.5 h-3.5" />
                  청첩장 공유하기
                </div>
                <p className="text-[21px] opacity-15 mt-4">Powered by 웨딩한방</p>
              </div>
            </div>

            {/* ── 템플릿 정보 + 선택 버튼 ── */}
            <div className="p-5 border-t border-black/[0.06]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[21px] font-semibold text-noir-800">{preview.name}</h3>
                    {preview.is_premium && <Crown className="w-4 h-4 text-gold" />}
                  </div>
                  <p className="text-[21px] text-taupe-500 capitalize mt-0.5">
                    {preview.category} · {preview.opening_animation} 오프닝
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {preview.color_palette.map((c, i) => (
                    <div
                      key={i}
                      className="w-5 h-5 rounded-full border border-black/[0.06]"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={handleConfirm}
                disabled={creating}
                className="w-full py-3.5 rounded-xl bg-noir-800 text-white text-[21px] font-medium hover:bg-noir-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    생성 중...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    이 템플릿으로 시작하기
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
