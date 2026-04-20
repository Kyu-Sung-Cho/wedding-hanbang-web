"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export default function CTA() {
  return (
    <section id="cta" className="bg-gradient-to-br from-ivory-deep to-ivory-warm py-[140px] px-[60px] text-center relative overflow-hidden max-md:py-20 max-md:px-5">
      <div className="absolute -top-[300px] left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(121,82,82,0.1),transparent)] rounded-full" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.8 }}
        className="relative z-10 max-w-[640px] mx-auto"
      >
        <div className="inline-flex items-center gap-2 text-[12px] tracking-[0.18em] uppercase text-rose-500 font-medium mb-5 justify-center">
          <span className="w-5 h-px bg-rose-500" />
          Get Started
        </div>
        <h2 className="font-serif-kr text-[clamp(32px,4vw,52px)] font-light leading-[1.3] tracking-tight mb-5">
          행복한 결혼 준비,
          <br />
          <em className="not-italic font-medium bg-gradient-to-br from-rose-500 to-gold bg-clip-text text-transparent">
            웨딩한방
          </em>
          과 함께
        </h2>
        <p className="text-[16px] text-charcoal leading-relaxed font-light mb-10">
          지금 바로 시작하세요. 카카오 또는 구글 계정으로
          <br className="hidden md:block" />
          간편하게 가입하고 모든 기능을 무료로 이용할 수 있습니다.
        </p>

        <a
          href="/login"
          className="group inline-flex items-center gap-2.5 px-10 py-4 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[15px] font-medium hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(121,82,82,0.25)] transition-all duration-300 mb-6 shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
        >
          무료로 시작하기
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </a>

        <p className="text-[12px] text-taupe-500">
          카카오 · 구글 간편 로그인 · 완전 무료
        </p>
      </motion.div>
    </section>
  );
}
