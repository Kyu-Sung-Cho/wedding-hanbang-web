import Image from "next/image";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "white";
  showText?: boolean;
  bordered?: boolean;
}

// 브라우저 탭 아이콘(`/images/favicon.png`)과 같은 그림이다. 48px 파비콘을 그대로 키우면
// 레티나에서 흐려져서, 같은 그림의 180px 판(apple-touch-icon)을 줄여 쓴다.
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <Image
      src="/images/apple-touch-icon.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className="shrink-0 rounded-[7px]"
      priority
    />
  );
}

export default function Logo({ size = "md", variant = "default", showText = true, bordered = false }: LogoProps) {
  const sizes = {
    sm: { icon: 32, text: 16, gap: 8 },
    md: { icon: 40, text: 20, gap: 10 },
    lg: { icon: 56, text: 28, gap: 14 },
  };

  const s = sizes[size];
  // 색을 직접 박지 않는다. 인라인 `style` 은 클래스 마이그레이션이 못 보는 자리라
  // 2026-08-28 색 개편에서 **여기만 옛 색으로 남았다** — 페이지 바탕이 어두운 잉크로
  // 바뀌었는데 로고 글자는 `#1A1A1F` 그대로여서 `/beta` 에서 대비가 1.13:1 이 됐다
  // (사실상 안 보인다). 역할 변수를 쓰면 표면 언어가 바뀔 때 같이 따라온다.
  const textColor = variant === "white" ? "var(--hb-on-primary)" : "var(--hb-text-strong)";

  const iconWrapperClass = bordered
    ? "bg-white rounded-[6px] p-1 border border-[#D4AFA0]"
    : variant === "white"
      ? "bg-white rounded-[6px] p-0.5"
      : "";

  return (
    <div className="flex items-center" style={{ gap: s.gap }}>
      <div className={iconWrapperClass}>
        <Image
          src="/images/logo-main.png"
          alt="웨딩한방 로고"
          width={s.icon}
          height={s.icon}
          className="object-contain"
          priority
        />
      </div>
      {showText && (
        <span
          className="font-serif-kr font-medium leading-tight"
          style={{ fontSize: s.text, color: textColor, letterSpacing: 0 }}
        >
          웨딩한방
        </span>
      )}
    </div>
  );
}
