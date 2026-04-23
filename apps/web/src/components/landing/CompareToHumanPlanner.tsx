"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface Row {
  label: string;
  human: string;
  amora: string;
}

const ROWS: Row[] = [
  { label: "상담 시간", human: "영업시간 내", amora: "24시간 365일" },
  { label: "비용", human: "200-500만원", amora: "무료 (베타)" },
  { label: "선호 발굴", human: "경험 기반", amora: "심리학·행동경제학 기반" },
  { label: "커플 소통", human: "각자 공유", amora: "실시간 함께 + 따로" },
  { label: "의사결정 기록", human: "메모장", amora: "Couple Memory Graph" },
  { label: "업체 정보", human: "제한적", amora: "AI 맞춤 추천" },
];

export default function CompareToHumanPlanner() {
  return (
    <section className="py-[clamp(80px,12vw,160px)] px-[clamp(20px,5vw,60px)] bg-ivory-50">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 md:mb-20 max-w-3xl"
        >
          <SectionLabel number="04" label="Comparison" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.15] tracking-tight">
            사람 플래너 <span className="text-taupe-400 font-light italic">versus</span>
            <br />
            <em className="not-italic text-rose-500">아모라.</em>
          </h2>
        </motion.div>

        {/* 에디토리얼 비교: 상단 라벨 + 6행 */}
        <div className="border-t border-b border-platinum/80">
          {/* 헤더 행 */}
          <div className="hidden md:grid md:grid-cols-[240px_1fr_1fr] gap-8 py-6 border-b border-platinum/60">
            <span className="text-[10px] tracking-[0.22em] uppercase text-taupe-400 font-medium" />
            <span className="text-[10px] tracking-[0.22em] uppercase text-taupe-400 font-medium">
              Human Planner
            </span>
            <span className="text-[10px] tracking-[0.22em] uppercase text-rose-500 font-medium">
              Amora
            </span>
          </div>

          {/* 데스크톱 행 */}
          <div className="hidden md:block divide-y divide-platinum/60">
            {ROWS.map((row, idx) => (
              <motion.div
                key={row.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: idx * 0.06 }}
                className="grid grid-cols-[240px_1fr_1fr] gap-8 py-7 group"
              >
                <span className="font-serif-kr text-base text-noir-800 font-medium">
                  {row.label}
                </span>
                <span className="text-[15px] text-charcoal font-light tracking-wide">
                  {row.human}
                </span>
                <span className="text-[15px] text-rose-500 font-medium tracking-wide">
                  {row.amora}
                </span>
              </motion.div>
            ))}
          </div>

          {/* 모바일 행 */}
          <div className="md:hidden divide-y divide-platinum/60">
            {ROWS.map((row, idx) => (
              <motion.div
                key={row.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: idx * 0.05 }}
                className="py-6"
              >
                <p className="font-serif-kr text-base text-noir-800 font-medium mb-3">
                  {row.label}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[9px] tracking-[0.2em] uppercase text-taupe-400 mb-1.5 font-medium">
                      Human
                    </p>
                    <p className="text-[14px] text-charcoal font-light">{row.human}</p>
                  </div>
                  <div>
                    <p className="text-[9px] tracking-[0.2em] uppercase text-rose-500 mb-1.5 font-medium">
                      Amora
                    </p>
                    <p className="text-[14px] text-rose-500 font-medium">{row.amora}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
