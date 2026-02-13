"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, DollarSign, HelpCircle, Shirt } from "lucide-react";

const painCards = [
  { icon: Clock, title: "시간 부족", desc: "직장인 커플은 업체 방문할 시간이 절대적으로 부족합니다" },
  { icon: DollarSign, title: "불투명한 비용", desc: "숨겨진 추가 비용과 20~30% 커미션이 가격에 포함됩니다" },
  { icon: HelpCircle, title: "정보의 바다", desc: "어디서부터 시작해야 할지, 무엇이 적정 가격인지 모릅니다" },
  { icon: Shirt, title: "드레스 선택 지옥", desc: "10곳 이상 방문해도 마음에 드는 드레스를 찾기 어렵습니다" },
];

export default function PainPoints() {
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
    <section className="bg-white px-6 py-20 md:py-28">
      <div
        ref={ref}
        className="mx-auto grid max-w-7xl items-center gap-12 md:grid-cols-2 md:gap-20"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        <div>
          <h2 className="mb-5 text-[clamp(28px,3.5vw,40px)] font-bold leading-[1.25] tracking-[-0.02em] text-gray-900">
            결혼 준비,
            <br />
            왜 이렇게 힘들까요?
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-gray-500">
            평균 결혼 준비 기간 10개월. 그 시간 동안 수십 곳의 업체를 비교하고, 불투명한 가격에 지치고, 추가 비용에 놀라는 일의 연속입니다.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {painCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="rounded-xl border border-gray-100 bg-white p-6"
                style={{
                  opacity: visible ? 1 : 0,
                  transform: visible ? "translateY(0)" : "translateY(16px)",
                  transition: `opacity 0.5s ease ${i * 0.1}s, transform 0.5s ease ${i * 0.1}s`,
                }}
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                  <Icon className="h-5 w-5 text-gray-600" />
                </div>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">{card.title}</h4>
                <p className="text-sm leading-relaxed text-gray-500">{card.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
