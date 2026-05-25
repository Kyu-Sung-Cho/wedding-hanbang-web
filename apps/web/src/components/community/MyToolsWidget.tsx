"use client";

import Link from "next/link";
import { BarChart3, FileSearch, LayoutDashboard, MessageCircle } from "lucide-react";

interface ToolCard {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const QUICK_TOOLS: ToolCard[] = [
  {
    href: "/community/quote-check",
    label: "견적 체크",
    description: "추가금·누락 항목 확인",
    icon: FileSearch,
  },
  {
    href: "/chat",
    label: "아모라 질문",
    description: "업체에 물어볼 말 정리",
    icon: MessageCircle,
  },
  {
    href: "/dashboard",
    label: "내 준비실",
    description: "체크리스트 결과를 다음 행동으로",
    icon: LayoutDashboard,
  },
];

interface MyToolsWidgetProps {
  /** sidebar: 모바일 메뉴 카드 / nav: 데스크탑 헤더 인라인 */
  variant?: "sidebar" | "nav";
}

export default function MyToolsWidget({ variant = "sidebar" }: MyToolsWidgetProps = {}) {
  if (variant === "nav") {
    return (
      <div className="hidden md:flex items-center gap-1.5">
        {QUICK_TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              title={`${tool.label} - ${tool.description}`}
              className="group flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-[#5d6879] transition-all hover:bg-[#F5F0EE] hover:text-[#9d6f36]"
            >
              <Icon className="h-4 w-4 text-[#9d6f36]" />
              <span className="hidden lg:inline">{tool.label}</span>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2 border-b border-[#eadfc9] pb-2">
        <BarChart3 className="h-4 w-4 text-[#9d6f36]" />
        <h3 className="font-serif-kr text-lg text-[#1C1917]">준비 도구</h3>
      </div>

      <div className="space-y-2">
        {QUICK_TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="group flex w-full items-start gap-3 rounded-xl bg-white p-3 text-left shadow-sm transition-all hover:bg-[#F5F0EE]/60"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-white">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#1C1917] group-hover:text-[#9d6f36]">
                  {tool.label}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-[#5d6879]">
                  {tool.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
