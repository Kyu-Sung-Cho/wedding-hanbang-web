"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

export default function B2BCTA() {
  const [subEmail, setSubEmail] = useState("");
  const [subStatus, setSubStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subEmail.trim() || subStatus === "sending") return;

    setSubStatus("sending");
    try {
      await fetch("/api/preregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: subEmail, source: "business_newsletter" }),
      });
      setSubStatus("success");
      setSubEmail("");
    } catch {
      setSubStatus("error");
    }
  };

  return (
    <section className="relative py-[clamp(80px,10vw,140px)] px-[clamp(20px,5vw,60px)] overflow-hidden bg-noir-800">
      {/* 배경 그라데이션 */}
      <div className="absolute inset-0">
        <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[min(900px,90vw)] h-[min(900px,90vw)] bg-[radial-gradient(circle,rgba(196,150,126,0.1),transparent_60%)] rounded-full" />
        <div className="absolute top-[-20%] right-[-10%] w-[min(500px,80vw)] h-[min(500px,80vw)] bg-[radial-gradient(circle,rgba(201,169,110,0.06),transparent)] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[min(400px,70vw)] h-[min(400px,70vw)] bg-[radial-gradient(circle,rgba(196,150,126,0.06),transparent)] rounded-full" />
      </div>

      <div className="relative z-10 max-w-[700px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.8 }}
        >
          <div className="inline-flex items-center gap-2 text-[38px] tracking-[0.18em] uppercase text-rose-light font-medium mb-8">
            <span className="w-5 h-px bg-rose-light" />
            Get Started
            <span className="w-5 h-px bg-rose-light" />
          </div>

          <h2 className="font-serif-kr text-[clamp(28px,4vw,48px)] font-light leading-[1.35] tracking-tight text-white mb-6">
            지금 파트너십 설문에
            <br />
            참여해주세요
          </h2>

          <p className="text-[clamp(14px,1.8vw,16px)] leading-relaxed text-white/50 font-light mx-auto max-w-[480px] mb-4">
            약 5분이면 충분합니다.
            <br className="hidden md:block" />
            설문을 기반으로 맞춤 파트너십 제안을 드립니다.
          </p>

          <p className="text-[25px] text-white/30 font-light mb-10">
            합리적 수수료 · 가입비 없음 · 언제든 해지 가능
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <Link
              href="/vendor/service"
              className="px-10 py-4 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[38px] font-medium hover:shadow-[0_8px_32px_rgba(196,150,126,0.3)] hover:-translate-y-0.5 transition-all max-md:w-full max-md:text-center"
            >
              서비스 안내 & 업체 등록
            </Link>
            <button
              onClick={() => document.getElementById("partner-types")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="px-10 py-4 rounded-full border border-white/20 text-white/80 text-[38px] font-medium hover:border-white/40 hover:text-white transition-all max-md:w-full max-md:text-center"
            >
              파트너 설문 참여하기
            </button>
          </div>

          {/* 이메일 구독 */}
          <div className="max-w-[440px] mx-auto mb-10">
            <p className="text-[25px] text-white/40 mb-3">파트너 소식과 업데이트를 이메일로 받아보세요</p>
            {subStatus === "success" ? (
              <p className="text-[23px] text-[#6BCB9A] font-medium py-3">구독이 완료되었습니다!</p>
            ) : (
              <form onSubmit={handleSubscribe} className="flex gap-2 max-sm:flex-col">
                <input
                  type="email"
                  value={subEmail}
                  onChange={(e) => setSubEmail(e.target.value)}
                  placeholder="이메일 주소를 입력해 주세요"
                  required
                  className="flex-1 px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white text-[23px] placeholder:text-white/30 outline-none focus:border-rose-500/40 transition-colors"
                />
                <button
                  type="submit"
                  disabled={subStatus === "sending"}
                  className="px-6 py-3 rounded-xl bg-white/[0.1] text-white/80 text-[23px] font-medium hover:bg-white/[0.15] transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {subStatus === "sending" ? "구독 중..." : "구독"}
                </button>
              </form>
            )}
            {subStatus === "error" && (
              <p className="text-[38px] text-rose-500 mt-2">오류가 발생했습니다. 다시 시도해 주세요.</p>
            )}
          </div>

          <div className="flex justify-center mb-16">
            <a
              href="mailto:partner@hanbang.ai"
              className="text-[25px] text-white/40 hover:text-white/60 transition-colors underline underline-offset-4"
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
          className="flex flex-wrap justify-center gap-x-[clamp(20px,3vw,40px)] gap-y-4 text-[25px] text-white/30"
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
