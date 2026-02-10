interface LogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "white";
  showText?: boolean;
}

export default function Logo({ size = "md", variant = "default", showText = true }: LogoProps) {
  const sizes = {
    sm: { icon: 32, text: 16, gap: 8 },
    md: { icon: 40, text: 20, gap: 10 },
    lg: { icon: 56, text: 28, gap: 14 },
  };

  const s = sizes[size];
  const textColor = variant === "white" ? "#FFFFFF" : "#1A1A1F";

  return (
    <div className="flex items-center" style={{ gap: s.gap }}>
      <svg
        width={s.icon}
        height={s.icon}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* 메인 그라디언트 */}
          <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4AFA0" />
            <stop offset="35%" stopColor="#C4967E" />
            <stop offset="70%" stopColor="#C9A96E" />
            <stop offset="100%" stopColor="#DCC9A0" />
          </linearGradient>
          {/* 골드 하이라이트 */}
          <linearGradient id="goldShine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#DCC9A0" stopOpacity="0" />
            <stop offset="50%" stopColor="#E8DEB5" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#DCC9A0" stopOpacity="0" />
          </linearGradient>
          {/* 외곽 그라디언트 */}
          <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D4AFA0" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#C9A96E" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#D4AFA0" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* 바깥 프레임 - 팔각형 느낌의 라운드 사각형 */}
        <rect
          x="2" y="2" width="116" height="116" rx="28"
          fill="none"
          stroke="url(#borderGrad)"
          strokeWidth="1.5"
        />

        {/* 메인 배경 */}
        <rect x="8" y="8" width="104" height="104" rx="24" fill="url(#logoGrad)" />

        {/* 내부 광택 효과 */}
        <rect x="8" y="8" width="104" height="52" rx="24" fill="url(#goldShine)" opacity="0.3" />

        {/* H 모노그램 - 세리프 스타일 */}
        <g transform="translate(60, 60)">
          {/* H의 왼쪽 기둥 */}
          <rect x="-26" y="-28" width="6.5" height="56" rx="1" fill="white" opacity="0.95" />
          {/* 왼쪽 상단 세리프 */}
          <rect x="-30" y="-28" width="14" height="2.5" rx="0.5" fill="white" opacity="0.95" />
          {/* 왼쪽 하단 세리프 */}
          <rect x="-30" y="25.5" width="14" height="2.5" rx="0.5" fill="white" opacity="0.95" />

          {/* H의 오른쪽 기둥 */}
          <rect x="19.5" y="-28" width="6.5" height="56" rx="1" fill="white" opacity="0.95" />
          {/* 오른쪽 상단 세리프 */}
          <rect x="16" y="-28" width="14" height="2.5" rx="0.5" fill="white" opacity="0.95" />
          {/* 오른쪽 하단 세리프 */}
          <rect x="16" y="25.5" width="14" height="2.5" rx="0.5" fill="white" opacity="0.95" />

          {/* H의 가로 바 */}
          <rect x="-20" y="-3.25" width="40" height="6.5" rx="1" fill="white" opacity="0.95" />
        </g>

        {/* 꼭짓점 장식 - 다이아몬드 */}
        <g opacity="0.7">
          <circle cx="20" cy="20" r="2" fill="white" />
          <circle cx="100" cy="20" r="2" fill="white" />
          <circle cx="20" cy="100" r="2" fill="white" />
          <circle cx="100" cy="100" r="2" fill="white" />
        </g>
      </svg>

      {showText && (
        <div className="flex flex-col">
          <span
            className="font-display tracking-[0.15em] uppercase leading-none"
            style={{ fontSize: s.text, color: textColor, fontWeight: 400 }}
          >
            HANBANG
          </span>
          <span
            className="font-serif-kr leading-none mt-[2px]"
            style={{ fontSize: s.text * 0.55, color: variant === "white" ? "rgba(255,255,255,0.5)" : "#928980", fontWeight: 300, letterSpacing: "0.08em" }}
          >
            웨딩한방
          </span>
        </div>
      )}
    </div>
  );
}
