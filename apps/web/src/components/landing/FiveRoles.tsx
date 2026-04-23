"use client";

import { motion } from "framer-motion";

interface Role {
  emoji: string;
  title: string;
  body: React.ReactNode;
}

const ROLES: Role[] = [
  {
    emoji: "🔍",
    title: "선호 발굴자",
    body: (
      <>
        &ldquo;예쁜 거&rdquo;가 아니라
        <br />
        &ldquo;왜 그게 좋은지&rdquo;까지.
      </>
    ),
  },
  {
    emoji: "🤝",
    title: "커플 중재자",
    body: (
      <>
        신부·신랑이 따로 대화한 후
        <br />
        함께 합의로 갑니다.
      </>
    ),
  },
  {
    emoji: "🧩",
    title: "제약 해결사",
    body: (
      <>
        예산·시간·지역·가족
        <br />
        모두 만족하는 길만 보여요.
      </>
    ),
  },
  {
    emoji: "📚",
    title: "기억 지킴이",
    body: (
      <>
        6개월 전 결정과 지금 결정을
        <br />
        연결해서 일관성 유지.
      </>
    ),
  },
  {
    emoji: "⚖️",
    title: "정보 격차 해소자",
    body: (
      <>
        업체가 아는 모든 걸
        <br />
        당신도 알 수 있게.
      </>
    ),
  },
];

export default function FiveRoles() {
  return (
    <section id="features" className="py-[clamp(60px,10vw,120px)] px-[clamp(20px,5vw,60px)] bg-ivory-50">
      <div className="max-w-[1200px] mx-auto">
        {/* 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <h2 className="font-serif-kr text-[clamp(28px,4vw,44px)] font-light text-noir-800 tracking-tight mb-3">
            다른 챗봇과 다른 5가지 역할
          </h2>
          <p className="text-charcoal text-sm md:text-base">
            단순 정보 검색 아니라 의사결정 동반자
          </p>
        </motion.div>

        {/* 5카드 그리드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {ROLES.map((role, idx) => (
            <motion.article
              key={role.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgba(26,26,31,0.04)] hover:shadow-[0_16px_48px_rgba(26,26,31,0.08)] hover:-translate-y-0.5 transition-all"
            >
              <div className="text-4xl mb-4" aria-hidden>
                {role.emoji}
              </div>
              <h3 className="font-serif-kr text-lg text-noir-800 font-medium mb-2">
                {role.title}
              </h3>
              <p className="text-charcoal text-sm leading-relaxed">
                {role.body}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
