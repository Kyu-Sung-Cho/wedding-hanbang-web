"use client";

import { motion } from "framer-motion";

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
    <section className="py-[clamp(60px,10vw,120px)] px-[clamp(20px,5vw,60px)] bg-ivory-50">
      <div className="max-w-[960px] mx-auto">
        {/* 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="font-serif-kr text-[clamp(28px,4vw,44px)] font-light text-noir-800 tracking-tight">
            사람 플래너 <span className="text-taupe-400 font-light">vs</span> 아모라
          </h2>
        </motion.div>

        {/* 데스크톱 표 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
          className="hidden md:block bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgba(26,26,31,0.06)]"
        >
          <table className="w-full">
            <thead>
              <tr className="bg-noir-800 text-white">
                <th className="text-left px-6 py-4 text-sm font-medium tracking-wide w-[28%]">
                  구분
                </th>
                <th className="text-left px-6 py-4 text-sm font-medium tracking-wide w-[36%]">
                  사람 플래너
                </th>
                <th className="text-left px-6 py-4 text-sm font-medium tracking-wide w-[36%]">
                  아모라
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, idx) => (
                <tr
                  key={row.label}
                  className={idx % 2 === 0 ? "bg-white" : "bg-ivory-50"}
                >
                  <td className="px-6 py-4 text-sm text-noir-800 font-medium border-t border-platinum/60">
                    {row.label}
                  </td>
                  <td className="px-6 py-4 text-sm text-charcoal border-t border-platinum/60">
                    {row.human}
                  </td>
                  <td className="px-6 py-4 text-sm text-rose-500 font-medium border-t border-platinum/60">
                    {row.amora}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        {/* 모바일 카드 */}
        <div className="md:hidden space-y-3">
          {ROWS.map((row, idx) => (
            <motion.div
              key={row.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              className="bg-white rounded-2xl p-5 shadow-[0_4px_14px_rgba(26,26,31,0.04)]"
            >
              <p className="text-xs tracking-widest uppercase text-taupe-400 mb-3 font-medium">
                {row.label}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-taupe-400 mb-1">사람 플래너</p>
                  <p className="text-sm text-charcoal">{row.human}</p>
                </div>
                <div>
                  <p className="text-[10px] text-rose-500 mb-1 font-medium">아모라</p>
                  <p className="text-sm text-rose-500 font-medium">{row.amora}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
