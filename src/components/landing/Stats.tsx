"use client";

import { useEffect, useRef, useState } from "react";

const stats = [
  { number: 24, suffix: "", label: "시간 상담 가능" },
  { number: 127, suffix: "", label: "개 체크리스트 항목" },
  { number: 20, suffix: "", label: "개 웨딩 카테고리" },
  { number: 30, suffix: "", label: "초 만에 드레스 피팅" },
];

function AnimatedNumber({ target, active }: { target: number; active: boolean }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    let start = 0;
    const duration = 1200;
    const step = Math.ceil(target / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(start);
      }
    }, 16);
    return () => clearInterval(timer);
  }, [active, target]);

  return <>{count}</>;
}

export default function Stats() {
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
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="border-y border-gray-200 bg-white px-6 py-20 text-center">
      <div ref={ref} className="mx-auto grid max-w-5xl grid-cols-2 gap-8 md:grid-cols-4 md:gap-12">
        {stats.map((stat) => (
          <div key={stat.label} className="p-4">
            <div className="mb-2 text-[clamp(40px,5vw,56px)] font-bold leading-none tracking-tight text-gray-900">
              <AnimatedNumber target={stat.number} active={visible} />
            </div>
            <div className="text-sm text-gray-500">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
