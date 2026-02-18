"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function B2BCTA() {
  return (
    <section className="relative py-[140px] px-[60px] overflow-hidden bg-noir-800 max-md:py-20 max-md:px-5">
      {/* 배경 그라데이션 */}
      <div className="absolute inset-0">
        <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-[radial-gradient(circle,rgba(196,150,126,0.1),transparent_60%)] rounded-full" />
        <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(201,169,110,0.06),transparent)] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(196,150,126,0.06),transparent)] rounded-full" />
      </div>

      <div className="relative z-10 max-w-[700px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.8 }}
        >
          <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-light font-medium mb-8">
            <span className="w-5 h-px bg-rose-light" />
            Get Started
            <span className="w-5 h-px bg-rose-light" />
          </div>

          <h2 className="font-serif-kr text-[clamp(28px,4vw,48px)] font-light leading-[1.35] tracking-tight text-white mb-6">
            지금 파트너십 설문에
            <br />
            참여해주세요
          </h2>

          <p className="text-[16px] leading-relaxed text-white/50 font-light mx-auto max-w-[480px] mb-4">
            약 5분이면 충분합니다.
            <br className="hidden md:block" />
            설문을 기반으로 맞춤 파트너십 제안을 드립니다.
          </p>

          <p className="text-[13px] text-white/30 font-light mb-10">
            합리적 수수료 · 가입비 없음 · 언제든 해지 가능
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link
              href="/vendor/register"
              className="px-10 py-4 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[15px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] hover:-translate-y-0.5 transition-all max-md:w-full max-md:text-center"
            >
              업체 등록하기
            </Link>
            <Link
              href="#partner-types"
              className="px-10 py-4 rounded-full border border-white/20 text-white/80 text-[15px] font-medium hover:border-white/40 hover:text-white transition-all max-md:w-full max-md:text-center"
            >
              파트너 설문 참여하기
            </Link>
          </div>
          <div className="flex justify-center mb-16">
            <a
              href="mailto:partner@hanbang.ai"
              className="text-[13px] text-white/40 hover:text-white/60 transition-colors underline underline-offset-4"
            >
              이메일 문의: partner@hanbang.ai
            </a>
          </div>
        </motion.div>

        {/* 신뢰 포인트 */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="flex flex-wrap justify-center gap-x-10 gap-y-4 text-[13px] text-white/30"
        >
          {[
            "✦ 개인정보 안전하게 보호",
            "✦ 설문 결과 비공개 처리",
            "✦ 5분 내 완료",
          ].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
