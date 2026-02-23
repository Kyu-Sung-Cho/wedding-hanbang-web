"use client";

import { useState } from "react";
import { motion } from "framer-motion";

export default function CustomerCTA() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/preregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus("success");
        setMessage("등록 완료! 출시 소식을 보내드릴게요.");
        setEmail("");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setStatus("error");
        setMessage(data.error || "등록 중 오류가 발생했습니다.");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch {
      setStatus("error");
      setMessage("네트워크 오류가 발생했습니다.");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <section id="cta" className="relative py-[140px] px-[60px] overflow-hidden max-md:py-20 max-md:px-5">
      {/* 배경 */}
      <div className="absolute inset-0 bg-gradient-to-br from-ivory-deep via-ivory-warm to-[#F0E8DD]" />
      <div className="absolute -top-[300px] left-1/2 -translate-x-1/2 w-[900px] h-[900px] bg-[radial-gradient(circle,rgba(196,150,126,0.12),transparent)] rounded-full" />
      <div className="absolute bottom-[-200px] right-[-100px] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(201,169,110,0.08),transparent)] rounded-full" />

      <div className="relative z-10 max-w-[640px] mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.8 }}
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
            사전 등록하시면 정식 출시 시 우선 초대와 함께
            <br className="hidden md:block" />
            특별 할인 혜택을 드립니다.
          </p>

          <form onSubmit={handleSubmit} className="flex gap-3 max-w-[480px] mx-auto mb-5 max-md:flex-col">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              className="flex-1 px-6 py-4 bg-white border-[1.5px] border-platinum rounded-full text-[14px] text-noir-800 outline-none focus:border-rose-500 transition-colors placeholder:text-taupe-400"
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className={`px-8 py-4 rounded-full text-[14px] font-medium whitespace-nowrap transition-all hover:-translate-y-0.5 max-md:w-full ${
                status === "success"
                  ? "bg-[#2E7D5A] text-white"
                  : "bg-noir-800 text-white hover:bg-noir-soft hover:shadow-[0_8px_24px_rgba(26,26,31,0.15)]"
              }`}
            >
              {status === "loading" ? "등록 중..." : status === "success" ? "등록 완료!" : "무료 사전등록"}
            </button>
          </form>

          {status === "error" && (
            <p className="text-[12px] text-rose-600 mb-2">{message}</p>
          )}

          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12px] text-taupe-500">
            <span>✦ 정식 출시 시 우선 초대</span>
            <span>✦ 사전등록자 한정 첫 3개월 무료</span>
            <span>✦ 스팸 없이 출시 소식만 전달</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
