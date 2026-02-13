"use client";

import { useEffect, useRef, useState } from "react";

const rows = [
  { label: "상담 가능 시간", old: "영업시간 내 전화/방문", ours: "24시간 AI 즉시 상담" },
  { label: "드레스 선택", old: "10곳 방문 · 하루종일 소요", ours: "AI 가상 피팅 · 10분" },
  { label: "비용 투명성", old: "숨겨진 커미션 20~30%", ours: "100% 투명한 가격" },
  { label: "플래너 비용", old: "50만원~200만원", ours: "월 구독 · 합리적 가격" },
  { label: "추가 비용 관리", old: "결제 후에야 알게 됨", ours: "AI가 사전 경고" },
  { label: "커플 공유", old: "카톡으로 사진 주고받기", ours: "실시간 자동 동기화" },
];

export default function Comparison() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="comparison"
      ref={ref}
      className="bg-white px-6 py-20 md:py-28"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}
    >
      <div className="mx-auto mb-16 max-w-xl text-center">
        <h2 className="mb-5 text-[clamp(28px,3.5vw,40px)] font-bold leading-[1.25] tracking-[-0.02em] text-gray-900">
          기존 방식 vs 웨딩한방
        </h2>
        <p className="text-base leading-relaxed text-gray-500">
          웨딩 플래너에게 맡기거나, 직접 발품을 파는 것이 전부였던 시대는 끝났습니다.
        </p>
      </div>

      <div className="mx-auto max-w-4xl overflow-hidden overflow-x-auto rounded-xl border border-gray-200">
        {/* 헤더 */}
        <div className="grid min-w-[600px] grid-cols-[180px_1fr_1fr] bg-gray-900 text-white">
          <div className="p-4 text-sm font-medium" />
          <div className="p-4 text-sm font-medium">기존 방식</div>
          <div className="p-4 text-sm font-medium">웨딩한방</div>
        </div>

        {/* 행 */}
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`grid min-w-[600px] grid-cols-[180px_1fr_1fr] ${
              i < rows.length - 1 ? "border-b border-gray-100" : ""
            }`}
          >
            <div className="flex items-center bg-gray-50 p-4 text-sm font-medium text-gray-700">
              {row.label}
            </div>
            <div className="flex items-center p-4 text-sm text-gray-400">
              {row.old}
            </div>
            <div className="flex items-center bg-gray-50/50 p-4 text-sm font-medium text-gray-900">
              <span className="mr-2 font-bold text-gray-900">✓</span>
              {row.ours}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
