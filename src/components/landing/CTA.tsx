"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function CTA() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async () => {
    if (!email || !email.includes("@")) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/preregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setStatus("success");
        setEmail("");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "등록에 실패했습니다.");
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch {
      setErrorMsg("네트워크 오류가 발생했습니다.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <section
      id="cta"
      className="relative overflow-hidden bg-gradient-to-b from-ivory-deep to-ivory-warm px-5 py-[100px] text-center md:px-[60px] md:py-[140px]"
    >
      <div className="absolute top-[-300px] left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,_rgba(196,150,126,0.1),_transparent)]" />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="relative z-[1] mx-auto max-w-[640px]"
      >
        <div className="mb-5 inline-flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-rose-500">
          <span className="h-px w-5 bg-rose-500" />
          Get Started
        </div>
        <h2 className="mb-5 font-serif text-[clamp(32px,4vw,52px)] font-light leading-[1.3] tracking-[-0.02em]">
          행복한 결혼 준비,
          <br />
          <em className="bg-gradient-to-br from-rose-500 to-gold bg-clip-text not-italic font-medium text-transparent">
            웨딩한방
          </em>
          과 함께
        </h2>
        <p className="mb-10 text-base font-light leading-[1.7] text-charcoal">
          AI 웨딩 플래너, 예산 관리, 일정 관리, 가상 드레스 피팅까지.
          <br />
          지금 바로 무료로 시작하세요.
        </p>

        {/* 서비스 시작 버튼 */}
        <div className="mb-10">
          <Link
            href="/login"
            className="group inline-flex items-center gap-2.5 rounded-full bg-noir-800 px-10 py-4 text-[15px] font-medium tracking-[-0.01em] text-white transition-all duration-400 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(26,26,31,0.2)]"
          >
            무료로 시작하기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* 사전등록 (이메일) */}
        <div className="mx-auto max-w-[480px] rounded-2xl border border-platinum bg-white/60 p-6 backdrop-blur-sm">
          <p className="mb-3 text-sm font-medium text-noir-800">또는 출시 소식 받기</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="이메일을 입력하세요"
              className="flex-1 rounded-full border-[1.5px] border-platinum bg-white px-5 py-3 text-sm text-noir-800 outline-none transition-colors placeholder:text-taupe-light focus:border-rose-500"
            />
            <button
              onClick={handleSubmit}
              disabled={status === "loading"}
              className={`whitespace-nowrap rounded-full px-6 py-3 text-sm font-medium transition-all hover:-translate-y-px ${
                status === "success"
                  ? "bg-[#2E7D5A] text-white"
                  : status === "error"
                    ? "bg-red-500 text-white"
                    : "bg-rose-500 text-white hover:bg-rose-600"
              }`}
            >
              {status === "loading"
                ? "등록 중..."
                : status === "success"
                  ? "등록 완료!"
                  : status === "error"
                    ? errorMsg
                    : "사전 등록"}
            </button>
          </div>
          <p className="mt-2 text-xs text-taupe-500">스팸 없이, 업데이트 소식만 전해드립니다.</p>
        </div>
      </motion.div>
    </section>
  );
}
