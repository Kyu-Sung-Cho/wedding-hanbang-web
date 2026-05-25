import Image from "next/image";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "default" | "white";
  showText?: boolean;
  bordered?: boolean;
}

export default function Logo({ size = "md", variant = "default", showText = true, bordered = false }: LogoProps) {
  const sizes = {
    sm: { icon: 32, text: 16, gap: 8 },
    md: { icon: 40, text: 20, gap: 10 },
    lg: { icon: 56, text: 28, gap: 14 },
  };

  const s = sizes[size];
  const textColor = variant === "white" ? "#FFFFFF" : "#1A1A1F";

  const iconWrapperClass = bordered
    ? "bg-white rounded-lg p-1 border border-[#D4AFA0]"
    : variant === "white"
      ? "bg-white rounded-lg p-0.5"
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
          className="font-serif-kr font-medium leading-none"
          style={{ fontSize: s.text, color: textColor, letterSpacing: 0 }}
        >
          웨딩한방
        </span>
      )}
    </div>
  );
}
