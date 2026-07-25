"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

// 아모라 체험은 그동안 로그인 페이지의 버튼 하나로만 들어갈 수 있었다.
// 가격을 다 본 사람에게 "체험하려면 로그인 페이지로 가세요"는 앞뒤가 맞지 않아
// 공개 표면에서 바로 체험 세션을 열어준다. 실패하면 설명 페이지로 보낸다.
export function StartDemoButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  async function startDemo() {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch("/api/demo/start", { method: "POST" });
      if (!response.ok) {
        window.location.href = "/demo";
        return;
      }
      // 이미 로그인한 사람은 샘플 화면이 아니라 자기 화면으로 보낸다.
      const body = await response.json().catch(() => null) as { alreadySignedIn?: boolean } | null;
      window.location.href = body?.alreadySignedIn ? "/wedding/chat" : "/wedding/lounge";
    } catch {
      window.location.href = "/demo";
    }
  }

  return (
    <button
      type="button"
      onClick={() => void startDemo()}
      disabled={pending}
      aria-busy={pending}
      className={className}
    >
      {pending ? "여는 중…" : "가입 없이 아모라 체험하기"}
      <ArrowRight aria-hidden="true" className="size-4" />
    </button>
  );
}
