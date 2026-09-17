import Link from "next/link";
import {
  MessageCircle,
  Users,
  Search,
  TrendingUp,
  Star,
  PenSquare,
  Shield,
  Sparkles,
  HeartHandshake,
  BookOpen,
  ArrowRight,
  Check,
  Megaphone,
} from "lucide-react";
import { weddingPath } from "@/lib/weddingPaths";

export const metadata = {
  title: "웨딩한방 안내",
  description:
    "웨딩한방 커뮤니티는 예비 신랑신부가 솔직한 후기와 견적 질문을 나누는 공간입니다. 동기방, 후기, 아모라 견적 체크리스트까지 한 곳에서.",
};

export default function CommunityAboutPage() {
  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)]">
      {/* ─── Hero ─── */}
      <section className="px-4 sm:px-6 md:px-10 pt-16 sm:pt-24 pb-12 sm:pb-16">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs tracking-[0.3em] text-[var(--hb-text-strong)] mb-5 font-medium uppercase">
            Wedding Hanbang Guide
          </p>
          <h1 className="font-serif-kr text-[var(--hb-text-strong)] mb-6">
            혼자 고민하지 마세요.
            <br />
            <em className="not-italic text-[var(--hb-text-strong)]">함께 준비해요.</em>
          </h1>
          <p className="text-base sm:text-lg text-[var(--hb-text-body)] font-light leading-relaxed max-w-xl mx-auto">
            웨딩한방 커뮤니티는 예비 신랑신부가 솔직한 후기와 정보를
            나누는 공간이에요. 같은 시기에 결혼하는 동기들과 함께,
            실제 경험을 참고해 더 차분하게 결정해보세요.
          </p>
        </div>
      </section>

      {/* ─── 우리의 취지 ─── */}
      <section className="px-4 sm:px-6 md:px-10 py-12 sm:py-16 bg-white border-y border-[var(--hb-hairline)]">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs tracking-[0.3em] text-[var(--hb-text-muted)] mb-3 font-medium uppercase">
            Why we exist
          </p>
          <h2 className="font-serif-kr text-[var(--hb-text-strong)] mb-8">
            왜 만들었나요?
          </h2>

          <div className="space-y-6 text-[var(--hb-text-strong)]">
            <p className="text-base sm:text-lg leading-[1.85] font-light">
              결혼 준비는 처음이라 모든 게 막막해요. 사진 촬영·드레스·메이크업
              가격을 어떻게 비교할지, 결혼식장에 따로 내는 금액은 무엇인지,
              어디서 정보를 얻어야 할지 알기 어려워요.
            </p>
            <p className="text-base sm:text-lg leading-[1.85] font-light">
              인터넷에 떠도는 후기는 광고인지 진짜인지 구분이 안 가고,
              주변엔 결혼 준비하는 친구가 많지 않아요. 결국 정보 비대칭으로
              필요 이상의 비용을 치르거나, 후회되는 결정을 내리게 돼요.
            </p>
            <p className="text-base sm:text-lg leading-[1.85] font-light">
              <span className="font-medium text-[var(--hb-text-strong)]">웨딩한방 커뮤니티</span>는
              회원들이 자신이 겪은 일과 궁금한 점을 나누고,
              같은 시기에 결혼하는 동기들끼리 응원하는 공간이에요.
              혼자 고민하던 결정을 함께 풀어나가요.
            </p>
          </div>
        </div>
      </section>

      {/* ─── 핵심 기능 ─── */}
      <section className="px-4 sm:px-6 md:px-10 py-12 sm:py-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs tracking-[0.3em] text-[var(--hb-text-muted)] mb-3 font-medium uppercase text-center">
            What you can do
          </p>
          <h2 className="font-serif-kr text-[var(--hb-text-strong)] mb-12 text-center">
            여기서 할 수 있는 것
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
            {[
              {
                icon: MessageCircle,
                title: "솔직한 후기 읽기",
                desc: "사진 촬영·드레스·메이크업, 결혼식장, 신혼여행에 관해 회원이 작성한 후기와 질문을 찾아봐요. 일반 글의 경험 여부는 별도 인증되지 않을 수 있어요.",
                color: "from-[var(--hb-primary)]/15 to-[var(--hb-primary)]/5",
                iconColor: "text-[var(--hb-text-strong)]",
              },
              {
                icon: Users,
                title: "동기방에서 함께 준비",
                desc: "같은 분기에 결혼하는 커플들이 모이는 동기방. 투어 동행자도 찾고, 정보도 나누고.",
                color: "from-sage-500/15 to-sage-500/5",
                iconColor: "text-[var(--hb-success)]",
              },
              {
                icon: Search,
                title: "원하는 정보 빠르게 검색",
                desc: "“강남 사진 촬영”, “드레스 추가 금액”처럼 구체적인 말로 관련 후기를 찾아요.",
                color: "from-[#7EB8D8]/15 to-[#7EB8D8]/5",
                iconColor: "text-[#5A9CC0]",
              },
              {
                icon: PenSquare,
                title: "내 경험 나누기",
                desc: "사진과 함께 후기를 올리면 비슷한 상황의 다른 커플에게 큰 도움이 돼요.",
                color: "from-[#B89785]/20 to-[var(--hb-primary-hover)]/5",
                iconColor: "text-[#B89785]",
              },
              {
                icon: TrendingUp,
                title: "투표로 좋은 글 추천",
                desc: "도움이 된 글에 반응하면 다른 예비부부도 더 빨리 찾을 수 있어요.",
                color: "from-[#A8D8A8]/30 to-[#A8D8A8]/5",
                iconColor: "text-[var(--hb-success)]",
              },
              {
                icon: Sparkles,
                title: "아모라 견적 체크리스트",
                desc: "받은 견적서의 빠진 항목, 추가금 가능성, 계약 전 질문을 먼저 정리해요.",
                color: "from-[var(--hb-primary)]/20 to-[var(--hb-primary-hover)]/5",
                iconColor: "text-[var(--hb-text-strong)]",
              },
            ].map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="bg-white rounded-[6px] border border-[#f0efed] p-6 sm:p-7 flex gap-4 sm:gap-5 hover:border-[var(--hb-primary)]/30 hover:shadow-sm transition-all"
                >
                  <div
                    className={`shrink-0 w-12 h-12 rounded-[6px] bg-gradient-to-br ${feature.color} flex items-center justify-center`}
                  >
                    <Icon className={`w-6 h-6 ${feature.iconColor}`} />
                  </div>
                  <div>
                    <h3 className="text-[var(--hb-text-strong)] mb-1.5">
                      {feature.title}
                    </h3>
                    <p className="text-sm sm:text-base text-[var(--hb-text-body)] font-light leading-relaxed">
                      {feature.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── 커뮤니티 약속 ─── */}
      <section className="px-4 sm:px-6 md:px-10 py-12 sm:py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs tracking-[0.3em] text-[var(--hb-text-muted)] mb-3 font-medium uppercase text-center">
            Our promise
          </p>
          <h2 className="font-serif-kr text-[var(--hb-text-strong)] mb-10 text-center">
            우리의 약속
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {[
              {
                Icon: Check,
                color: "#0284C7",
                bg: "#F0F9FF",
                border: "#BAE6FD",
                label: "일반",
                desc: "일반 회원이 작성한 글 · 경험 인증 아님",
              },
              {
                Icon: Star,
                color: "#A16207",
                bg: "#FEFCE8",
                border: "#FDE68A",
                label: "협찬",
                desc: "혜택을 받았지만 솔직하게",
              },
              {
                Icon: Megaphone,
                color: "#334155",
                bg: "#F1F5F9",
                border: "#CBD5E1",
                label: "광고",
                desc: "업체 광고임을 글에 표시",
              },
            ].map((rule) => (
              <div
                key={rule.label}
                className="bg-white rounded-[6px] border border-[#f0efed] p-5 sm:p-6 text-center"
              >
                <div
                  className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center border"
                  style={{ backgroundColor: rule.bg, borderColor: rule.border, color: rule.color }}
                  aria-hidden
                >
                  <rule.Icon className="w-5 h-5" strokeWidth={2.5} />
                </div>
                <div className="text-base font-semibold text-[var(--hb-text-strong)] mb-1">
                  {rule.label}
                </div>
                <div className="text-sm text-[var(--hb-text-body)] font-light leading-relaxed">
                  {rule.desc}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-gradient-to-br from-[var(--hb-surface-page)] to-white rounded-[6px] border border-[#f0efed] p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-12 h-12 rounded-[6px] bg-[var(--hb-primary)] flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-[var(--hb-text-strong)] mb-2">
                  광고와 추천은 분명히 구분합니다
                </h3>
                <p className="text-sm sm:text-base text-[var(--hb-text-body)] font-light leading-relaxed">
                  업체와 협력 관계에 있는 글은 명확히 표시되고, 알고리즘
                  추천에서 제외돼요. 신고된 글은 별도 기준으로 검토되며,
                  거짓·과장된 후기는 제재 대상이에요. 신뢰는 우리 커뮤니티의
                  가장 중요한 자산이에요.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 신뢰 기반 ─── */}
      <section className="px-4 sm:px-6 md:px-10 py-12 sm:py-16 bg-[var(--hb-primary)] text-white">
        <div className="max-w-3xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
            {[
              {
                icon: HeartHandshake,
                title: "서로 도와요",
                desc: "한 명의 후기가 다른 커플의 결정을 더 쉽게 만들어요.",
              },
              {
                icon: BookOpen,
                title: "솔직하게 써요",
                desc: "좋았던 점도, 아쉬웠던 점도 모두 적어주세요.",
              },
              {
                icon: Shield,
                title: "안전하게 지켜요",
                desc: "익명 활동이지만 인격 모독·허위 글은 제재돼요.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="text-center">
                  <div className="w-12 h-12 rounded-[6px] bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                    <Icon className="w-6 h-6 text-[var(--hb-on-primary)]" />
                  </div>
                  <h3 className="font-serif-kr text-white mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-[var(--hb-on-primary)] font-light leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="px-4 sm:px-6 md:px-10 py-16 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <Star className="w-8 h-8 text-[#B89785] mx-auto mb-5" />
          <h2 className="font-serif-kr text-[var(--hb-text-strong)] mb-4">
            지금 시작해보세요
          </h2>
          <p className="text-base sm:text-lg text-[var(--hb-text-body)] font-light leading-relaxed mb-8 max-w-xl mx-auto">
            서로의 경험이 누군가에게는 큰 도움이 됩니다.
            <br />
            지금 바로 커뮤니티를 둘러보세요.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href={weddingPath()}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-[6px] bg-[var(--hb-primary)] text-white text-base font-medium shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] transition-all"
            >
              커뮤니티 둘러보기
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href={weddingPath("/community/post/write")}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-[6px] bg-white border border-[var(--hb-hairline)] text-[var(--hb-text-strong)] text-base font-medium hover:bg-[var(--hb-surface-page)] transition-all"
            >
              <PenSquare className="w-4 h-4" />첫 글 쓰러 가기
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
