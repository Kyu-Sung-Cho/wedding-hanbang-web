"use client";

import { motion } from "framer-motion";
import SectionLabel from "./SectionLabel";

interface Role {
  number: string;
  title: string;
  body: React.ReactNode;
}

const ROLES: Role[] = [
  {
    number: "01",
    title: "업체 원문 확인하기",
    body: (
      <>
        견적서·계약서에 적힌
        <span className="text-noir-800"> 포함 범위와 추가 조건</span>을 업체에 직접 확인합니다.
      </>
    ),
  },
  {
    number: "02",
    title: "업체 질문 정리하기",
    body: (
      <>
        애매한 답변을 그대로 넘기지 않도록
        <span className="text-noir-800"> 다시 물어볼 문장</span>을 정리합니다.
      </>
    ),
  },
  {
    number: "03",
    title: "예산에 직접 기록하기",
    body: (
      <>
        업체가 서면으로 확정한 금액과 추가 조건을
        <span className="text-noir-800"> 내 예산표에 이어서</span> 관리합니다.
      </>
    ),
  },
  {
    number: "04",
    title: "일정에 직접 기록하기",
    body: (
      <>
        계약 전 질문과 마감일을
        <span className="text-noir-800"> 다음 할 일</span>로 남겨둡니다.
      </>
    ),
  },
  {
    number: "05",
    title: "비슷한 후기 찾아보기",
    body: (
      <>
        웨딩홀·스드메처럼 같은 준비 주제의 후기를
        <span className="text-noir-800"> 커뮤니티에서 찾아</span> 참고합니다.
      </>
    ),
  },
];

export default function FiveRoles() {
  return (
    <section id="features" className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-ivory-warm">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-24 max-w-3xl"
        >
          <SectionLabel label="준비 도구" />
          <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.2] tracking-[-0.01em] mb-5">
            질문에서 기록까지,
            <br />
            <em className="not-italic text-rose-500">준비 흐름이 끊기지 않게.</em>
          </h2>
          <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
            업체 원문과 커뮤니티에서 참고한 내용을 확정 사실과 구분해 예산·일정에 직접 기록할 수 있습니다.
          </p>
        </motion.div>

        {/* 5 행 — 얇은 구분선 기반 */}
        <div className="divide-y divide-platinum/70 border-t border-b border-platinum/70">
          {ROLES.map((role, idx) => (
            <motion.article
              key={role.number}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay: idx * 0.08 }}
              className="group grid grid-cols-[56px_1fr] md:grid-cols-[96px_220px_1fr] gap-x-6 md:gap-x-12 gap-y-3 py-10 md:py-12 items-baseline hover:bg-white/50 transition-colors"
            >
              {/* 넘버 */}
              <span className="font-display text-2xl md:text-[28px] text-rose-500 font-light tracking-tight">
                {role.number}
              </span>

              {/* 제목 */}
              <h3 className="font-serif-kr text-[20px] md:text-[24px] text-noir-800 font-medium tracking-[-0.005em]">
                {role.title}
              </h3>

              {/* 설명 */}
              <p className="text-taupe-500 text-[15px] md:text-base leading-[1.85] font-light col-span-2 md:col-span-1 md:max-w-lg">
                {role.body}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
