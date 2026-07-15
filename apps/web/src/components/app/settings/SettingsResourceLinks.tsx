import Link from "next/link";
import { ChevronRight } from "lucide-react";

const RESOURCES = [
  { label: "이용약관", href: "/terms" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "문의 안내", href: "/support" },
] as const;

export default function SettingsResourceLinks() {
  return (
    <>
      {RESOURCES.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex w-full items-center justify-between px-6 py-5 transition-colors hover:bg-[#F6F3F2]"
        >
          <span className="text-[17px] text-[#1A1A1F]">{item.label}</span>
          <ChevronRight className="h-5 w-5 text-[#B5ADA3]" />
        </Link>
      ))}
      <div className="flex w-full items-center justify-between px-6 py-5">
        <span className="text-[17px] text-[#1A1A1F]">앱 버전</span>
        <span className="text-base text-[#B5ADA3]">v1.0.0 (Beta)</span>
      </div>
    </>
  );
}
