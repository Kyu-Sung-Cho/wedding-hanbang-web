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
    title: "선호 발굴자",
    body: (
      <>
        &ldquo;예쁜 거&rdquo;가 아니라 <em className="not-italic text-noir-800 font-normal">왜 그게 좋은지</em>까지.
      </>
    ),
  },
  {
    number: "02",
    title: "커플 중재자",
    body: (
      <>
        신부 &middot; 신랑이 <em className="not-italic text-noir-800 font-normal">따로 대화한 후</em> 함께 합의로.
      </>
    ),
  },
  {
    number: "03",
    title: "제약 해결사",
    body: (
      <>
        예산 &middot; 시간 &middot; 지역 &middot; 가족 <em className="not-italic text-noir-800 font-normal">모두 만족하는 길</em>만.
      </>
    ),
  },
  {
    number: "04",
    title: "기억 지킴이",
    body: (
      <>
        6개월 전 결정과 지금 결정을 <em className="not-italic text-noir-800 font-normal">연결해 일관성</em> 유지.
      </>
    ),
  },
  {
    number: "05",
    title: "정보 격차 해소자",
    body: (
      <>
        업체가 아는 모든 걸 <em className="not-italic text-noir-800 font-normal">당신도 알 수 있게</em>.
      </>
    ),
  },
];

export default function FiveRoles() {
  return (
    <section id="features" className="py-[clamp(80px,12vw,160px)] px-[clamp(20px,5vw,60px)] bg-ivory-warm">
      <div className="max-w-[1240px] mx-auto">
        {/* 에디토리얼 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 md:mb-24 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 md:gap-16 items-end"
        >
          <div>
            <SectionLabel number="02" label="Five Roles" />
            <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.15] tracking-tight">
              다른 챗봇과 다른
              <br />
              <em className="not-italic text-rose-500">다섯 가지 역할.</em>
            </h2>
          </div>
          <p className="text-charcoal text-[15px] leading-[1.9] font-light md:pb-3 max-w-md">
            단순 정보 검색이 아닌, 의사결정의 동반자.
            아모라는 당신 곁에서 다섯 가지 역할을 수행합니다.
          </p>
        </motion.div>

        {/* 5 카드 — 가로 구분선 + 여백 중심 */}
        <div className="divide-y divide-platinum/80 border-t border-b border-platinum/80">
          {ROLES.map((role, idx) => (
            <motion.article
              key={role.number}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay: idx * 0.08 }}
              className="group grid grid-cols-[auto_1fr] md:grid-cols-[80px_auto_1fr] gap-x-6 md:gap-x-10 gap-y-2 py-8 md:py-10 items-baseline hover:bg-white/60 transition-colors"
            >
              {/* 넘버 */}
              <span className="font-display text-2xl md:text-3xl text-rose-500 font-light tracking-tight">
                {role.number}
              </span>

              {/* 제목 */}
              <h3 className="font-serif-kr text-xl md:text-2xl text-noir-800 font-medium tracking-tight col-span-1 md:col-span-1">
                {role.title}
              </h3>

              {/* 설명 */}
              <p className="text-charcoal text-[15px] leading-[1.85] font-light col-span-2 md:col-span-1 md:text-right md:max-w-md md:ml-auto">
                {role.body}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
