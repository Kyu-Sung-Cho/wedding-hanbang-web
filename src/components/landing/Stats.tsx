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
    <section className="bg-noir-800 text-white py-[100px] px-[60px] text-center max-md:py-20 max-md:px-5">
      <div className="grid grid-cols-4 gap-10 max-w-[1000px] mx-auto max-lg:grid-cols-2 max-md:gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="p-5"
          >
            <div className="font-display text-[clamp(44px,5vw,64px)] font-light bg-gradient-to-br from-rose-light to-gold-light bg-clip-text text-transparent leading-none mb-3">
              {stat.number}
            </div>
            <div className="text-[31px] text-white/50 font-light tracking-wide">
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
