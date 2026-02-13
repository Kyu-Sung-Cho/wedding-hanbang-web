"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  { title: "회원가입", desc: "카카오 또는 구글로 간편 로그인" },
  { title: "커플 연동", desc: "초대 코드로 파트너와 연결하면 모든 정보가 실시간 공유" },
  { title: "온보딩", desc: "결혼일, 예산, 현재 상황을 입력하면 AI가 맞춤 플랜을 세워드려요" },
  { title: "AI와 함께 준비", desc: "언제든 AI에게 물어보고, 드레스 입어보고, 예산 관리하세요" },
];

export default function HowItWorks() {
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
      id="how"
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
          시작은 간단합니다
        </h2>
        <p className="text-base leading-relaxed text-gray-500">
          4단계만으로 AI 웨딩 플래너와 함께 결혼 준비를 시작하세요.
        </p>
      </div>

      <div className="relative mx-auto grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
        {/* 연결선 (데스크탑) */}
        <div className="absolute top-7 right-[80px] left-[80px] hidden h-px border-t-2 border-dashed border-gray-200 md:block" />

        {steps.map((step, i) => (
          <div
            key={step.title}
            className="relative text-center"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(16px)",
              transition: `opacity 0.5s ease ${i * 0.1}s, transform 0.5s ease ${i * 0.1}s`,
            }}
          >
            <div className="relative z-10 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-lg font-bold text-white">
              {i + 1}
            </div>
            <h4 className="mb-2 text-sm font-semibold text-gray-900">{step.title}</h4>
            <p className="text-sm leading-relaxed text-gray-500">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
