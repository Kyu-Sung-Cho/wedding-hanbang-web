"use client";

import { Heart, MessagesSquare, BarChart3, Scale } from "lucide-react";

export interface MediationBlock {
  empathy?: string;        // 공감 — 감정 인정
  translation?: string;    // 통역 — 양쪽 표면 주장 → 진짜 니즈
  data?: string;           // 데이터 — 객관적 근거 (커뮤니티 통계 등)
  resolution?: string;     // 합의안 — 중립적 타협 제안
}

/**
 * 커플 갈등 중재 응답 시각화.
 * 시스템 프롬프트가 [mediation]...[/mediation] 마커로 4단계를 구조화해서 응답하면,
 * 백엔드가 추출해서 ChatMessage.metadata.mediation에 저장.
 * 4개 필드 중 일부만 있어도 graceful — 있는 것만 렌더.
 */
export default function MediationCard({ block }: { block: MediationBlock }) {
  const blocks = [
    {
      key: "empathy" as const,
      title: "공감",
      Icon: Heart,
      color: "#A16207",
      bg: "#FEFCE8",
      border: "#FDE68A",
      text: block.empathy,
    },
    {
      key: "translation" as const,
      title: "양쪽 입장 통역",
      Icon: MessagesSquare,
      color: "#0284C7",
      bg: "#F0F9FF",
      border: "#BAE6FD",
      text: block.translation,
    },
    {
      key: "data" as const,
      title: "객관적 근거",
      Icon: BarChart3,
      color: "#334155",
      bg: "#F1F5F9",
      border: "#CBD5E1",
      text: block.data,
    },
    {
      key: "resolution" as const,
      title: "합의안",
      Icon: Scale,
      color: "#795252",
      bg: "#fffdfb",
      border: "#d9c8c8",
      text: block.resolution,
    },
  ].filter((b) => Boolean(b.text?.trim()));

  if (blocks.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 animate-fade-in">
      {blocks.map((b, i) => (
        <div
          key={b.key}
          className="rounded-xl border p-3.5 sm:p-4 animate-fade-in"
          style={{
            backgroundColor: b.bg,
            borderColor: b.border,
            animationDelay: `${i * 120}ms`,
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#ffffff", color: b.color, border: `1px solid ${b.border}` }}
            >
              <b.Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <span
              className="text-xs font-semibold tracking-wide"
              style={{ color: b.color }}
            >
              {b.title}
            </span>
          </div>
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap"
            style={{ color: "#1b1c1c" }}
          >
            {b.text}
          </p>
        </div>
      ))}
    </div>
  );
}
