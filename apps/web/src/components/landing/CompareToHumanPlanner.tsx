"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface Row {
  label: string;
  human: string;
  amora: string;
}

const ROWS: Row[] = [
  { label: "대화 방식", human: "약속한 시간에 사람과 상담", amora: "서비스 접속 시 AI와 대화" },
  { label: "비용", human: "서비스·계약 범위에 따라 다름", amora: "이용 방법과 비용은 아직 정해지지 않았어요" },
  { label: "선호 정리", human: "상담 경험 기반", amora: "대화에서 확인한 조건·취향 기반" },
  { label: "커플 소통", human: "상담 내용과 자료를 직접 공유", amora: "공유 대화와 개인 대화를 구분" },
  { label: "의사결정 기록", human: "상담 방식에 따라 다름", amora: "확인한 결정과 변경 이력을 저장" },
  { label: "업체 정보", human: "플래너의 관계·경험에 따라 다름", amora: "공개·입력 정보를 정리하고 원문 확인 안내" },
];

export default function CompareToHumanPlanner() {
  return (
    <section className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-[var(--hb-surface-page)]">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-24 max-w-3xl"
        >
          <SectionLabel label="역할이 다른 두 가지 도움" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-[var(--hb-text-strong)] leading-[1.2] tracking-normal">
            아모라는 사람 플래너를
            <br />
            <em className="not-italic text-[var(--hb-accent-hover)]">대체한다고 약속하지 않아요.</em>
          </h2>
          <p className="mt-6 max-w-2xl text-[15px] leading-7 text-charcoal">
            사람의 현장 경험과 중재가 필요한 일, 반복해서 조건을 정리하고 기록하는 일은 서로 다릅니다. 상황에 맞게 함께 사용할 수 있도록 차이를 설명합니다.
          </p>
        </motion.div>

        {/* 비교 — 3컬럼 editorial */}
        <div className="border-t border-b border-platinum/70">
          {/* 헤더 라벨 — 데스크톱 */}
          <div className="hidden md:grid md:grid-cols-[240px_1fr_1fr] gap-10 py-7 border-b border-platinum/60">
            <span />
            <span className="text-[12px] md:text-[13px] text-[var(--hb-text-muted)] font-medium">
              사람 플래너
            </span>
            <span className="text-[12px] md:text-[13px] text-[var(--color-rose-700)] font-medium">
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
                <span className="font-serif-kr text-[17px] text-[var(--hb-text-strong)] font-medium">
                  {row.label}
                </span>
                <span className="text-[15px] text-charcoal font-light">
                  {row.human}
                </span>
                <span className="text-[15px] text-[var(--hb-accent-hover)] font-medium">
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
                <p className="font-serif-kr text-[17px] text-[var(--hb-text-strong)] font-medium mb-4">
                  {row.label}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] text-[var(--hb-text-muted)] mb-2 font-medium">
                      사람 플래너
                    </p>
                    <p className="text-[14px] text-charcoal font-light leading-relaxed">{row.human}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--color-rose-700)] mb-2 font-medium">
                      아모라
                    </p>
                    <p className="text-[14px] text-[var(--color-rose-700)] font-medium leading-relaxed">{row.amora}</p>
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
