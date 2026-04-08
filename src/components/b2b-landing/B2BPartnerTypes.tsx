"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const partnerTypes = [
  {
    type: "스튜디오",
    icon: "📸",
    desc: "촬영 스튜디오 대표님의 현장 목소리를 듣고 싶습니다",
    benefits: [
      "고객 매칭 방식, 대표님이 직접 설계에 참여",
      "포트폴리오 노출 방향을 함께 결정",
      "현장의 진짜 어려움을 서비스에 반영",
    ],
    href: "/business_studio",
    gradient: "from-rose-500/20 to-gold/20",
    accent: "text-rose-500",
    accentBg: "bg-rose-500/10",
  },
  {
    type: "드레스샵",
    icon: "👗",
    desc: "드레스·한복 매장 대표님의 경험을 서비스에 담고 싶습니다",
    benefits: [
      "AI 가상 피팅, 현장 의견을 반영해 설계",
      "고객 매칭 기준을 함께 만들어갑니다",
      "매장 운영의 실제 고민을 서비스로 해결",
    ],
    href: "/business_dress",
    gradient: "from-gold/20 to-rose-500/20",
    accent: "text-gold",
    accentBg: "bg-gold/10",
  },
  {
    type: "메이크업",
    icon: "💄",
    desc: "메이크업 전문가의 노하우가 서비스에 담깁니다",
    benefits: [
      "고객 매칭 기준, 전문가 의견으로 설계",
      "패키지 구성 방향을 함께 결정",
      "현장 운영의 불편함을 서비스로 개선",
    ],
    href: "/business_makeup",
    gradient: "from-rose-500/20 to-[rgba(180,140,160,0.2)]",
    accent: "text-rose-500",
    accentBg: "bg-rose-500/10",
  },
];

export default function B2BPartnerTypes() {
  return (
    <section id="partner-types" className="bg-white py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] relative scroll-mt-16">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-platinum to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="text-center max-w-[640px] mx-auto mb-20"
      >
        <div className="inline-flex items-center gap-2 text-[38px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5">
          <span className="w-5 h-px bg-rose-500" />
          Partner Survey
        </div>
        <h2 className="font-serif-kr text-[clamp(28px,3.5vw,44px)] font-light leading-[1.35] tracking-tight mb-5">
          업종별 설문 조사
        </h2>
        <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-charcoal font-light mx-auto max-w-[520px]">
          대표님들의 현장 목소리를 직접 듣고 서비스에 반영합니다.
          <br className="hidden md:block" />
          해당하는 업종을 선택해 소중한 의견을 들려주세요.
        </p>
      </motion.div>

      <div className="max-w-[1100px] mx-auto grid grid-cols-3 gap-[clamp(20px,2.5vw,28px)] max-lg:grid-cols-1 max-lg:max-w-[520px]">
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

            <div className="relative p-8 max-md:p-6 flex flex-col h-full">
              <div className="w-14 h-14 rounded-2xl bg-noir-800 flex items-center justify-center text-[38px] mb-6">
                {partner.icon}
              </div>

              <h3 className="font-serif-kr text-[clamp(18px,2.5vw,22px)] font-normal text-noir-800 mb-2 tracking-tight">
                {partner.type}
              </h3>
              <p className="text-[clamp(13px,1.5vw,14px)] text-taupe-500 font-light mb-6 flex-1">{partner.desc}</p>

              <div className="flex flex-col gap-3 mb-8">
                {partner.benefits.map((benefit) => (
                  <div key={benefit} className="flex items-start gap-2.5">
                    <span className={`${partner.accent} text-[23px] mt-0.5 flex-shrink-0`}>&#x2713;</span>
                    <span className="text-[25px] text-charcoal font-light leading-relaxed">{benefit}</span>
                  </div>
                ))}
              </div>

              {/* 설문 참여 혜택 */}
              <div className="bg-ivory-100 rounded-xl p-4 mb-5 border border-platinum/50">
                <p className="text-[38px] text-rose-600 font-medium mb-2 tracking-wide">참여 혜택</p>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[38px] text-charcoal font-light flex items-center gap-1.5">
                    <span className={`${partner.accent} text-[23px]`}>&#x2713;</span>
                    정식 출시 우선 초대
                  </span>
                  <span className="text-[38px] text-charcoal font-light flex items-center gap-1.5">
                    <span className={`${partner.accent} text-[23px]`}>&#x2713;</span>
                    베타 파트너 수수료 할인
                  </span>
                  <span className="text-[38px] text-charcoal font-light flex items-center gap-1.5">
                    <span className={`${partner.accent} text-[23px]`}>&#x2713;</span>
                    맞춤 기능 우선 개발 반영
                  </span>
                </div>
              </div>

              <Link
                href={partner.href}
                className={`inline-flex items-center gap-2 px-6 py-3 rounded-full ${partner.accentBg} ${partner.accent} text-[23px] font-medium hover:opacity-80 transition-opacity`}
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
