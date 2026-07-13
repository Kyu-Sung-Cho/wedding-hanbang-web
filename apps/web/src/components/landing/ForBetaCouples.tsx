"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import {
  shouldShowBetaCounter,
  USER_RESEARCH_COHORT_BENEFITS,
  USER_RESEARCH_COHORT_CONDITIONS,
} from "@/constants/beta";
import SectionLabel from "./SectionLabel";

interface ForBetaCouplesProps {
  /** 실시간 신청자 수 (server fetch). 미전달 시 0. */
  current?: number;
  total?: number;
}

export default function ForBetaCouples({ current = 0, total = 50 }: ForBetaCouplesProps) {
  const BETA_CURRENT = current;
  const BETA_TOTAL = total;
  const showCounter = shouldShowBetaCounter(BETA_CURRENT);

  return (
    <section
      id="cta"
      className="relative py-[clamp(112px,16vw,200px)] px-[clamp(20px,5vw,60px)] overflow-hidden bg-noir-800"
    >
      {/* 은은한 따뜻한 glow 레이어 */}
      <div
        className="absolute top-[18%] right-[-12%] w-[min(780px,90vw)] h-[min(780px,90vw)] bg-[radial-gradient(circle,rgba(212,175,160,0.18),transparent_65%)] rounded-full pointer-events-none"
        aria-hidden
      />
      <div
        className="absolute bottom-[-20%] left-[-10%] w-[min(560px,85vw)] h-[min(560px,85vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.10),transparent_62%)] rounded-full pointer-events-none"
        aria-hidden
      />

      <div className="relative z-10 max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-20 md:mb-24 max-w-3xl"
        >
          <SectionLabel label="사용자 연구 코호트" tone="light" />
          <h2 className="font-serif-kr text-[clamp(28px,5vw,56px)] font-light text-white leading-[1.25] tracking-[-0.015em]">
            6주간 함께해 주실
            <br />
            <em className="not-italic text-rose-light">최대 50명</em>을 찾습니다.
          </h2>
          <p className="mt-6 max-w-2xl text-[14px] font-light leading-[1.8] text-white/65 md:text-[15px]">
            일반 베타 계정 이용과 별도로, 선정 후 안내되는 시작일부터 6주간 심층 피드백에 참여하는 연구입니다.
          </p>
        </motion.div>

        {/* 좌측 혜택·조건 + 우측 CTA */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-16 lg:gap-24 items-start">
          {/* 좌측 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7 }}
            className="space-y-14"
          >
            {/* Benefits */}
            <div>
              <p className="text-[12px] md:text-[13px] tracking-[0.22em] text-rose-light/80 mb-7 font-medium">
                사용자 연구 참여 혜택
              </p>
              <ul className="space-y-6">
                {USER_RESEARCH_COHORT_BENEFITS.map((benefit, idx) => (
                  <li
                    key={benefit}
                    className="flex items-baseline gap-6 text-[15px] md:text-[17px] text-white/90 font-light leading-[1.7]"
                  >
                    <span className="font-display text-rose-light/70 text-sm shrink-0 w-7">
                      0{idx + 1}
                    </span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Conditions */}
            <div className="pt-10 border-t border-white/10">
              <p className="text-[12px] md:text-[13px] tracking-[0.22em] text-rose-light/80 mb-6 font-medium">
                참여 조건
              </p>
              <ul className="space-y-4 text-[14px] md:text-[15px] text-white/70 font-light leading-[1.8]">
                {USER_RESEARCH_COHORT_CONDITIONS.map((cond) => (
                  <li key={cond} className="flex items-baseline gap-5">
                    <span className="text-rose-light/40">·</span>
                    <span>{cond}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          {/* 우측: CTA 카드 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="lg:sticky lg:top-24"
          >
            <div className="border border-white/15 rounded-[28px] p-8 md:p-10 backdrop-blur-sm bg-white/[0.03]">
              <p className="text-[12px] md:text-[13px] tracking-[0.28em] text-rose-light font-medium mb-8">
                사용자 연구 코호트 · 최대 {BETA_TOTAL}명 선정
              </p>

              {showCounter ? (
                <>
                  {/* 진척 수치 — sans-serif + tabular-nums (Cormorant "1" Roman numeral 혼동 방지) */}
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="font-sans tabular-nums text-white text-[clamp(40px,8vw,60px)] font-light leading-none tracking-[-0.02em]">
                      {BETA_CURRENT}
                    </span>
                    <span className="text-white/50 text-lg md:text-xl font-light">
                      건 접수
                    </span>
                  </div>
                  <p className="text-[12px] md:text-[13px] tracking-[0.22em] text-white/50 mb-8 font-medium">
                    신청자를 검토해 최대 {BETA_TOTAL}명을 선정합니다
                  </p>

                  <div className="h-px bg-white/10 w-full mb-12" aria-hidden />
                </>
              ) : (
                <p className="mb-12 text-[13px] font-medium tracking-[0.16em] text-white/55">
                  사용자 연구 신청 접수 중 · 최대 {BETA_TOTAL}명 선정
                </p>
              )}

              {/* CTA */}
              <Link
                href="/beta"
                className="group inline-flex items-center gap-2 text-[14px] md:text-[15px] text-white font-medium border-b border-white pb-2 tracking-[0.02em] hover:text-rose-light hover:border-rose-light transition-colors"
              >
                사용자 연구 신청하기
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
