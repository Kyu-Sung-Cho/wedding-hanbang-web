"use client";

import { useState } from "react";

export default function Hero() {
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
    <section className="bg-white pt-24 pb-16 md:pt-32 md:pb-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 md:grid-cols-2 md:gap-16">
        {/* 좌측: 텍스트 + CTA */}
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-gray-600">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            지금 바로 무료로 시작
          </div>

          <h1 className="mb-6 text-[clamp(36px,5vw,60px)] font-bold leading-[1.15] tracking-[-0.02em] text-gray-900">
            결혼 준비,
            <br />
            AI 한 방이면
            <br />
            됩니다
          </h1>

          <p className="mb-8 max-w-lg text-lg leading-relaxed text-gray-500">
            24시간 AI 웨딩 플래너, 가상 드레스 피팅, 스마트 예산 관리까지.
            웨딩 플래너 없이도 완벽한 결혼 준비를 시작하세요.
          </p>

          {/* 이메일 CTA */}
          <div className="mb-4 flex max-w-md flex-col gap-3 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="이메일을 입력하세요"
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900"
            />
            <button
              onClick={handleSubmit}
              disabled={status === "loading"}
              className={`whitespace-nowrap rounded-lg px-6 py-3 text-sm font-medium transition-colors ${
                status === "success"
                  ? "bg-green-600 text-white"
                  : status === "error"
                    ? "bg-red-500 text-white"
                    : "bg-gray-900 text-white hover:bg-gray-800"
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

          {status === "idle" && (
            <p className="text-xs text-gray-400">
              무료로 시작하세요. 신용카드가 필요하지 않습니다.
            </p>
          )}
        </div>

        {/* 우측: 대시보드 목업 */}
        <div className="relative">
          {/* 브라우저 프레임 */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
            {/* 브라우저 탑바 */}
            <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
              </div>
              <div className="mx-auto rounded-md bg-white px-8 py-1 text-xs text-gray-400">
                hanbang.ai/dashboard
              </div>
            </div>

            {/* 대시보드 내용 */}
            <div className="space-y-4 p-5">
              {/* 상단 카드 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-gray-900 p-4 text-white">
                  <p className="mb-1 text-xs text-gray-400">결혼식까지</p>
                  <p className="text-2xl font-bold">D-120</p>
                  <p className="mt-1 text-xs text-gray-400">2025.10.18</p>
                </div>
                <div className="rounded-lg border border-gray-100 p-4">
                  <p className="mb-1 text-xs text-gray-500">총 예산</p>
                  <p className="text-lg font-bold text-gray-900">₩10,000,000</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full w-[45%] rounded-full bg-gray-900" />
                  </div>
                  <p className="mt-1 text-xs text-gray-400">45% 사용</p>
                </div>
              </div>

              {/* AI 채팅 프리뷰 */}
              <div className="rounded-lg border border-gray-100 p-4">
                <p className="mb-3 text-xs font-medium text-gray-500">AI 웨딩 플래너</p>
                <div className="space-y-2">
                  <div className="self-end rounded-lg rounded-br-sm bg-gray-900 px-3 py-2 text-xs text-white">
                    스튜디오 어떻게 골라야 해?
                  </div>
                  <div className="rounded-lg rounded-bl-sm bg-gray-100 px-3 py-2 text-xs text-gray-700">
                    D-120일 기준 스튜디오 선택 시 중요한 4가지를 알려드릴게요...
                  </div>
                </div>
              </div>

              {/* 카테고리 진행률 */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "스튜디오", pct: 100 },
                  { label: "드레스", pct: 60 },
                  { label: "메이크업", pct: 30 },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-gray-100 p-3 text-center">
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="mt-1 text-sm font-bold text-gray-900">{item.pct}%</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 플로팅 배지 */}
          <div className="absolute -bottom-4 -left-4 rounded-lg border border-gray-200 bg-white px-4 py-2.5 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-xs">
                ✓
              </div>
              <div>
                <p className="text-xs font-medium text-gray-900">AI 피팅 완료</p>
                <p className="text-[10px] text-gray-400">방금 전</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
