"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Check, ArrowRight } from "lucide-react";

const BENEFITS = [
  "무료 Premium (실거래가 + Contract Diff)",
  "아모라 풀 기능 우선 사용",
  "종료 후 6개월 무료 연장",
  "정식 출시 시 선배 신부 인증",
];

const CONDITIONS = [
  "2026년 6~12월 결혼 예정",
  "신부 + 신랑 모두 참여 가능",
  "주 1회 짧은 피드백",
];

const BETA_TOTAL = 50;
const BETA_CURRENT = 0;

export default function ForBetaCouples() {
  const progress = Math.min(100, (BETA_CURRENT / BETA_TOTAL) * 100);

  return (
    <section
      id="cta"
      className="relative py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] overflow-hidden bg-gradient-to-br from-rose-500 via-rose-600 to-rose-500"
    >
      {/* 배경 장식 — 화이트 glow로 깊이감 */}
      <div className="absolute -top-[150px] left-1/2 -translate-x-1/2 w-[min(700px,90vw)] h-[min(700px,90vw)] bg-[radial-gradient(circle,rgba(255,255,255,0.18),transparent_65%)] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-120px] right-[-80px] w-[min(500px,80vw)] h-[min(500px,80vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.15),transparent_60%)] rounded-full pointer-events-none" />
      <div className="absolute top-[40%] left-[-100px] w-[min(400px,70vw)] h-[min(400px,70vw)] bg-[radial-gradient(circle,rgba(255,255,255,0.1),transparent_60%)] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-[720px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8 }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 bg-white/20 text-white px-4 py-1.5 rounded-full text-sm font-medium mb-6 backdrop-blur-sm">
            베타 50쌍 한정
          </div>

          {/* H2 */}
          <h2 className="font-serif-kr text-[clamp(28px,4.5vw,52px)] text-white font-light leading-tight tracking-tight mb-8">
            6주간 함께해주실<br className="sm:hidden" /> 50쌍을 찾습니다
          </h2>

          {/* Benefits */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 mb-6 text-left">
            <p className="text-white/80 text-xs tracking-widest uppercase mb-4 font-medium">
              베타 참여 시
            </p>
            <ul className="space-y-3">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2.5 text-white text-[15px] leading-relaxed">
                  <Check className="w-5 h-5 shrink-0 mt-0.5 text-white" aria-hidden />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Conditions */}
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 mb-8 text-left">
            <p className="text-white/80 text-xs tracking-widest uppercase mb-4 font-medium">
              조건
            </p>
            <ul className="space-y-2 text-white/90 text-sm leading-relaxed">
              {CONDITIONS.map((cond) => (
                <li key={cond} className="flex items-start gap-2">
                  <span className="text-white/60 mt-0.5">·</span>
                  <span>{cond}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <Link
            href="/beta"
            className="group inline-flex items-center gap-2 px-10 py-4 bg-white text-rose-500 rounded-xl text-[15px] font-medium shadow-[0_8px_28px_rgba(0,0,0,0.15)] hover:shadow-[0_14px_40px_rgba(0,0,0,0.2)] hover:-translate-y-0.5 transition-all"
          >
            베타 신청하기
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          {/* Progress Bar */}
          <div className="mt-10 max-w-[360px] mx-auto">
            <div className="flex justify-between text-xs text-white/80 mb-2">
              <span>현재 신청</span>
              <span>
                {BETA_CURRENT}쌍 / {BETA_TOTAL}쌍
              </span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-700"
                style={{ width: `${progress}%` }}
                aria-hidden
              />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
