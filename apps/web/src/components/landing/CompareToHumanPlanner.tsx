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
  { label: "비용", human: "200~500만원", amora: "무료 (베타)" },
  { label: "선호 정리", human: "상담 경험 기반", amora: "대화에서 확인한 조건·취향 기반" },
  { label: "커플 소통", human: "각자 공유", amora: "실시간 함께 + 따로" },
  { label: "의사결정 기록", human: "메모장", amora: "Couple Memory Graph" },
  { label: "업체 정보", human: "제한적", amora: "AI 맞춤 추천" },
];

export default function CompareToHumanPlanner() {
  return (
    <section className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-ivory-50">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-24 max-w-3xl"
        >
          <SectionLabel label="사람 플래너와 비교" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.2] tracking-[-0.01em]">
            같은 고민에 대한
            <br />
            <em className="not-italic text-rose-500">다른 접근</em>.
          </h2>
        </motion.div>

        {/* 비교 — 3컬럼 editorial */}
        <div className="border-t border-b border-platinum/70">
          {/* 헤더 라벨 — 데스크톱 */}
          <div className="hidden md:grid md:grid-cols-[240px_1fr_1fr] gap-10 py-7 border-b border-platinum/60">
            <span />
            <span className="text-[12px] md:text-[13px] tracking-[0.22em] text-taupe-400 font-medium">
              사람 플래너
            </span>
            <span className="text-[12px] md:text-[13px] tracking-[0.22em] text-rose-500 font-medium">
              아모라
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
                className="grid grid-cols-[240px_1fr_1fr] gap-10 py-8"
              >
                <span className="font-serif-kr text-[17px] text-noir-800 font-medium">
                  {row.label}
                </span>
                <span className="text-[15px] text-charcoal font-light">
                  {row.human}
                </span>
                <span className="text-[15px] text-rose-500 font-medium">
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
                className="py-7"
              >
                <p className="font-serif-kr text-[17px] text-noir-800 font-medium mb-4">
                  {row.label}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] tracking-[0.2em] text-taupe-400 mb-2 font-medium">
                      사람 플래너
                    </p>
                    <p className="text-[14px] text-charcoal font-light leading-relaxed">{row.human}</p>
                  </div>
                  <div>
                    <p className="text-[11px] tracking-[0.2em] text-rose-500 mb-2 font-medium">
                      아모라
                    </p>
                    <p className="text-[14px] text-rose-500 font-medium leading-relaxed">{row.amora}</p>
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
