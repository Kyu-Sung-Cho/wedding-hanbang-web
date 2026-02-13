"use client";

import { useState } from "react";

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
    <section id="cta" className="bg-gray-900 px-6 py-20 text-center md:py-28">
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-5 text-[clamp(28px,3.5vw,40px)] font-bold leading-[1.25] tracking-[-0.02em] text-white">
          행복한 결혼 준비,
          <br />
          웨딩한방과 함께
        </h2>
        <p className="mb-10 text-base leading-relaxed text-gray-400">
          AI 웨딩 플래너, 예산 관리, 일정 관리, 가상 드레스 피팅까지.
          <br />
          지금 바로 무료로 시작하세요.
        </p>

        <div className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="이메일을 입력하세요"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-white"
          />
          <button
            onClick={handleSubmit}
            disabled={status === "loading"}
            className={`whitespace-nowrap rounded-lg px-6 py-3 text-sm font-medium transition-colors ${
              status === "success"
                ? "bg-green-600 text-white"
                : status === "error"
                  ? "bg-red-500 text-white"
                  : "bg-white text-gray-900 hover:bg-gray-100"
            }`}
          >
            {status === "loading"
              ? "등록 중..."
              : status === "success"
                ? "등록 완료!"
                : status === "error"
                  ? errorMsg
                  : "무료로 시작하기"}
          </button>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          스팸 없이, 업데이트 소식만 전해드립니다.
        </p>
      </div>
    </section>
  );
}
