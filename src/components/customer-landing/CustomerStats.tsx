"use client";

import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) => Math.round(v));

  useEffect(() => {
    if (!ref.current || hasAnimated) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasAnimated(true);
          animate(motionValue, value, { duration: 2, ease: "easeOut" });
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [motionValue, value, hasAnimated]);

  useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = `${v}${suffix}`;
    });
    return unsubscribe;
  }, [rounded, suffix]);

  return <span ref={ref}>0{suffix}</span>;
}

const stats = [
  { value: 24, suffix: "시간", label: "AI 상담 가능 시간", desc: "새벽에도 즉시 답변" },
  { value: 127, suffix: "가지", label: "체크리스트 항목", desc: "20개 카테고리 완벽 커버" },
  { value: 30, suffix: "초", label: "가상 드레스 피팅", desc: "사진 한 장이면 완성" },
  { value: 20, suffix: "개", label: "웨딩 카테고리", desc: "빠짐없이 체계적으로" },
];

export default function CustomerStats() {
  return (
    <section className="bg-noir-800 py-[120px] px-[60px] relative overflow-hidden max-md:py-20 max-md:px-5">
      <div className="absolute inset-0">
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(196,150,126,0.08),transparent)] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(201,169,110,0.06),transparent)] rounded-full" />
      </div>

      <div className="max-w-[1000px] mx-auto grid grid-cols-4 gap-10 relative z-10 max-lg:grid-cols-2 max-md:grid-cols-2 max-md:gap-8">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.7, delay: i * 0.12 }}
            className="text-center"
          >
            <div className="font-display text-[clamp(36px,5vw,56px)] font-light bg-gradient-to-r from-rose-500 to-gold bg-clip-text text-transparent leading-none mb-3">
              <AnimatedNumber value={stat.value} suffix={stat.suffix} />
            </div>
            <div className="text-[14px] text-white font-medium mb-1">{stat.label}</div>
            <div className="text-[12px] text-white/40 font-light">{stat.desc}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
