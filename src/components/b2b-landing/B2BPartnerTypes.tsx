"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const partnerTypes = [
  {
    type: "스튜디오",
    icon: "📸",
    desc: "웨딩 촬영 스튜디오를 운영하시는 사장님",
    benefits: [
      "AI가 촬영 컨셉·예산 맞는 고객만 연결",
      "포트폴리오 자동 최적화 노출",
      "시즌별 촬영 트렌드 리포트 제공",
    ],
    href: "/business_studio",
    gradient: "from-rose-500/20 to-gold/20",
    accent: "text-rose-500",
    accentBg: "bg-rose-500/10",
  },
  {
    type: "드레스샵",
    icon: "👗",
    desc: "웨딩드레스·한복 매장을 운영하시는 사장님",
    benefits: [
      "AI 가상 피팅으로 방문 전 흥미 유발",
      "체형·스타일 맞춤 고객 매칭",
      "대여/구매 의향 사전 파악",
    ],
    href: "/business_dress",
    gradient: "from-gold/20 to-rose-500/20",
    accent: "text-gold",
    accentBg: "bg-gold/10",
  },
  {
    type: "메이크업",
    icon: "💄",
    desc: "웨딩 메이크업샵을 운영하시는 사장님",
    benefits: [
      "피부 타입·선호 스타일 매칭",
      "리허설+본식 패키지 제안 자동화",
      "시술 후기 기반 고객 유입",
    ],
    href: "/business_makeup",
    gradient: "from-rose-500/20 to-[rgba(180,140,160,0.2)]",
    accent: "text-rose-500",
    accentBg: "bg-rose-500/10",
  },
];

export default function B2BPartnerTypes() {
  return (
    <section id="partner-types" className="bg-white py-[140px] px-[60px] relative max-md:py-20 max-md:px-5">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Partnership
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          업종별 맞춤 파트너십
        </h2>
        <p className="text-[16px] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          각 업종의 특성에 맞는 솔루션을 제공합니다.
          <br className="hidden md:block" />
          아래에서 해당하는 업종을 선택해 설문에 참여해주세요.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-3 gap-7 max-lg:grid-cols-1 max-lg:max-w-[520px]">
        {partnerTypes.map((partner, i) => (
          <motion.div
            key={partner.type}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.7, delay: i * 0.12 }}
            className="group relative rounded-3xl border border-black/[0.06] overflow-hidden hover:-translate-y-2 hover:shadow-[0_24px_64px_rgba(0,0,0,0.08)] transition-all duration-500"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${partner.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

            <div className="relative p-8 max-md:p-6">
              <div className="w-14 h-14 rounded-2xl bg-noir-800 flex items-center justify-center text-[24px] mb-6">
                {partner.icon}
              </div>

              <h3 className="font-serif-kr text-[22px] font-normal text-noir-800 mb-2 tracking-tight">
                {partner.type}
              </h3>
              <p className="text-[14px] text-taupe-500 font-light mb-6">{partner.desc}</p>

              <div className="flex flex-col gap-3 mb-8">
                {partner.benefits.map((benefit) => (
                  <div key={benefit} className="flex items-start gap-2.5">
                    <span className={`${partner.accent} text-[14px] mt-0.5 flex-shrink-0`}>&#x2713;</span>
                    <span className="text-[13px] text-charcoal font-light leading-relaxed">{benefit}</span>
                  </div>
                ))}
              </div>

              <Link
                href={partner.href}
                className={`inline-flex items-center gap-2 px-6 py-3 rounded-full ${partner.accentBg} ${partner.accent} text-[14px] font-medium hover:opacity-80 transition-opacity`}
              >
                설문 참여하기
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
