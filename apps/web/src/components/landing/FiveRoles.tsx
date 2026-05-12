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
    title: "받은 견적 확인하기",
    body: (
      <>
        금액만 보지 않고
        <span className="text-noir-800"> 빠진 항목과 추가금 가능성</span>을 먼저 확인합니다.
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
    title: "예산에 반영하기",
    body: (
      <>
        확인한 견적과 숨은 비용을
        <span className="text-noir-800"> 내 예산표에 이어서</span> 관리합니다.
      </>
    ),
  },
  {
    number: "04",
    title: "일정으로 넘기기",
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
        같은 지역, 비슷한 예산의 사례를
        <span className="text-noir-800"> 커뮤니티에서 함께</span> 확인합니다.
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
            견적에서 일정까지,
            <br />
            <em className="not-italic text-rose-500">준비 흐름이 끊기지 않게.</em>
          </h2>
          <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
            아모라는 커뮤니티에서 확인한 내용을 내 준비실의 다음 행동으로 이어줍니다.
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
