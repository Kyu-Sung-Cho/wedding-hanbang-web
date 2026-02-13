"use client";

import { useEffect, useRef, useState } from "react";

const testimonials = [
  {
    initials: "김",
    name: "김지은 예비신부",
    detail: "2025년 10월 결혼 예정",
    text: "새벽에 갑자기 스튜디오 고민이 생겼는데 AI가 바로 상담해줘서 감동이었어요. 실제 플래너보다 더 자세하게 알려줬어요.",
  },
  {
    initials: "박",
    name: "박서연 예비신부",
    detail: "2025년 6월 결혼 예정",
    text: "AI 드레스 피팅이 진짜 신기해요. 집에서 편하게 입어보고 마음에 드는 것만 직접 가서 확인했더니 시간이 엄청 절약됐어요.",
  },
  {
    initials: "이",
    name: "이수민 신부",
    detail: "2025년 3월 결혼 완료",
    text: "남편이랑 같이 앱 쓰니까 따로 카톡으로 공유 안 해도 되고, 예산 관리가 한눈에 되니까 싸울 일이 줄었어요 ㅋㅋ",
  },
];

export default function Testimonials() {
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
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="reviews"
      ref={ref}
      className="bg-gray-50 px-6 py-20 text-center md:py-28"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: "opacity 0.6s ease, transform 0.6s ease",
      }}
    >
      <h2 className="mb-16 text-[clamp(28px,3.5vw,40px)] font-bold leading-[1.25] tracking-[-0.02em] text-gray-900">
        예비 신부님들의 이야기
      </h2>

      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
        {testimonials.map((t, i) => (
          <div
            key={t.name}
            className="rounded-xl border border-gray-200 bg-white p-8 text-left"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(16px)",
              transition: `opacity 0.5s ease ${i * 0.1}s, transform 0.5s ease ${i * 0.1}s`,
            }}
          >
            <p className="mb-6 text-sm leading-relaxed text-gray-600">
              &ldquo;{t.text}&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-sm font-bold text-white">
                {t.initials}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">{t.name}</div>
                <div className="text-xs text-gray-400">{t.detail}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
