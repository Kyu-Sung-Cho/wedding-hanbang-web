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
            잠시 연결이 원활하지 않습니다
          </h1>
          <p style={{ fontSize: 14, color: "#928980", marginBottom: 24, lineHeight: 1.6 }}>
            입력하신 내용은 그대로 두고 잠시 후 다시 시도해 주세요.
            계속 같은 문제가 생기면 고객지원으로 알려주세요.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#B5ADA3", marginBottom: 16 }}>
              오류 코드: {error.digest}
            </p>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: "12px 28px",
                background: "#36534E",
                color: "#fff",
                border: "none",
                borderRadius: 999,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              다시 시도
            </button>
            <a
              href="/support"
              style={{
                padding: "11px 28px",
                background: "#fff",
                color: "#36534E",
                border: "1px solid #D8CEC2",
                borderRadius: 999,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              고객지원
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
