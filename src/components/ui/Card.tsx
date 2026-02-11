"use client";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  hover?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const paddingStyles: Record<string, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export default function Card({
  children,
  className = "",
  padding = "md",
  hover = false,
  onClick,
  style,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={`rounded-2xl border border-platinum bg-white ${
        paddingStyles[padding]
      } ${hover ? "cursor-pointer transition-shadow hover:shadow-md" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
