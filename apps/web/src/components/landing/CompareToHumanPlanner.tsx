"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface Row {
  label: string;
  human: string;
  amora: string;
}

const ROWS: Row[] = [
  { label: "상담", human: "사람의 경험과 맥락 판단", amora: "필요할 때 질문하고 답변 참고" },
  { label: "이용 비용", human: "플래너별 계약 조건 확인", amora: "현재 베타 계정 별도 이용료 없음" },
  { label: "선호 정리", human: "대화와 경험을 바탕으로 제안", amora: "입력한 선호를 기준표로 정리" },
  { label: "커플 소통", human: "상담 내용을 커플이 다시 공유", amora: "같은 일정·예산 화면을 함께 확인" },
  { label: "기록", human: "상담 메모와 계약서를 직접 보관", amora: "사용자가 저장한 일정·예산을 한곳에서 확인" },
  { label: "업체 정보", human: "네트워크와 현장 경험", amora: "공개 정보와 검토 후보를 참고" },
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
          <SectionLabel label="사람의 판단을 보완" />
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
              사람 플래너의 강점
            </span>
            <span className="text-[12px] md:text-[13px] tracking-[0.22em] text-rose-500 font-medium">
              웨딩한방 도구
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
                      사람 플래너의 강점
                    </p>
                    <p className="text-[14px] text-charcoal font-light leading-relaxed">{row.human}</p>
                  </div>
                  <div>
                    <p className="text-[11px] tracking-[0.2em] text-rose-500 mb-2 font-medium">
                      웨딩한방 도구
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
