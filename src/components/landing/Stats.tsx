"use client";

import { motion } from "framer-motion";

const stats = [
  { number: "24", label: "시간 상담 가능" },
  { number: "127", label: "개 체크리스트 항목" },
  { number: "20", label: "개 웨딩 카테고리" },
  { number: "30", label: "초 만에 드레스 피팅" },
];

export default function Stats() {
  return (
    <section className="bg-noir-800 px-5 py-[100px] text-center text-white">
      <div className="mx-auto grid max-w-[1000px] grid-cols-2 gap-6 md:grid-cols-4 md:gap-10">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="p-5"
          >
            <div className="mb-3 bg-gradient-to-br from-rose-light to-gold-light bg-clip-text font-display text-[clamp(44px,5vw,64px)] font-light leading-[1.1] text-transparent">
              {stat.number}
            </div>
            <div className="text-[13px] font-light tracking-[0.02em] text-white/50">
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
