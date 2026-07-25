"use client";

import { useEffect } from "react";

// 최후의 에러 화면(루트 레이아웃까지 깨진 경우). 사용자에게는 스택·내부 메시지를
// 절대 보여주지 않는다 — 원문은 콘솔·모니터링으로만 흘리고, 화면에는 다음 행동만 둔다.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          fontFamily: "'Paperlogy', sans-serif",
          background: "#FBF8F2",
          color: "#243832",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: 20,
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#8F6662", marginBottom: 8 }}>
            잠시 문제가 생겼어요
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>화면을 불러오지 못했어요</h1>
          <p style={{ fontSize: 14, color: "#243832", opacity: 0.7, marginBottom: 24, lineHeight: 1.7 }}>
            저장된 일정·예산·대화 내용은 그대로예요. 다시 시도해도 같은 화면이 나오면 잠시 후에 열어봐 주세요.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 48,
                padding: "0 24px",
                background: "#36534E",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              다시 시도하기
            </button>
            <a
              href="/wedding"
              style={{
                minHeight: 48,
                padding: "0 24px",
                display: "inline-flex",
                alignItems: "center",
                background: "#fff",
                color: "#243832",
                border: "1px solid rgba(36,56,50,0.18)",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              홈으로 가기
            </a>
          </div>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "rgba(36,56,50,0.45)", marginTop: 20 }}>
              문의 시 알려주세요 · 오류 코드 {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
