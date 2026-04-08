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
  { value: 3, suffix: "종", label: "파트너 업종", sub: "스튜디오·드레스·메이크업" },
  { value: 20, suffix: "개", label: "웨딩 카테고리", sub: "스튜디오·드레스·메이크업 등" },
  { value: 24, suffix: "h", label: "AI 고객 응대", sub: "연중무휴 자동 응답" },
  { value: 100, suffix: "%", label: "성과 기반", sub: "계약 성사 시에만 수수료" },
];

export default function B2BStats() {
  return (
    <section className="bg-noir-800 py-[clamp(80px,10vw,120px)] px-[clamp(20px,5vw,60px)] relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-[-30%] right-[-15%] w-[min(500px,80vw)] h-[min(500px,80vw)] bg-[radial-gradient(circle,rgba(196,150,126,0.08),transparent)] rounded-full" />
        <div className="absolute bottom-[-30%] left-[-15%] w-[min(400px,70vw)] h-[min(400px,70vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.06),transparent)] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[600px] mx-auto mb-16 relative z-10"
      >
        <div className="inline-flex items-center gap-2 text-[38px] tracking-[0.18em] uppercase text-rose-light font-medium mb-5">
          <span className="w-5 h-px bg-rose-light" />
          Numbers
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight text-white">
          숫자로 보는 웨딩한방
        </h2>
      </motion.div>

      <div className="max-w-[1250px] mx-auto grid grid-cols-4 gap-[clamp(20px,3vw,32px)] relative z-10 max-lg:grid-cols-2 max-md:grid-cols-2">
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
            <div className="text-[clamp(13px,1.5vw,14px)] text-white font-medium mb-1">{stat.label}</div>
            <div className="text-[clamp(11px,1.2vw,12px)] text-white/40 font-light">{stat.sub}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
