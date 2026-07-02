"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          fontFamily: "'Paperlogy', sans-serif",
          background: "#FDFCFA",
          color: "#1A1A1F",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 500 }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, marginBottom: 12 }}>
            문제가 발생했습니다
          </h1>
          <p style={{ fontSize: 14, color: "#928980", marginBottom: 24, lineHeight: 1.6 }}>
            {error.message || "알 수 없는 오류가 발생했습니다."}
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#B5ADA3", marginBottom: 16 }}>
              오류 코드: {error.digest}
            </p>
          )}
          <pre
            style={{
              fontSize: 11,
              color: "#9A6B62",
              background: "#FAF8F5",
              padding: 16,
              borderRadius: 8,
              textAlign: "left",
              overflowX: "auto",
              marginBottom: 24,
              maxHeight: 200,
              border: "1px solid #F5F2ED",
            }}
          >
            {error.stack || "스택 정보 없음"}
          </pre>
          <button
            onClick={reset}
            style={{
              padding: "12px 32px",
              background: "#1A1A1F",
              color: "#fff",
              border: "none",
              borderRadius: 999,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
