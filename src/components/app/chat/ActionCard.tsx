"use client";

import type { ToolExecutionResult } from "@/types/database.types";
import {
  Wallet,
  Calendar,
  CheckCircle2,
  MapPin,
  BarChart3,
  ListChecks,
  Info,
  XCircle,
} from "lucide-react";

interface ActionCardProps {
  result: ToolExecutionResult;
}

function getIcon(toolName: string) {
  switch (toolName) {
    case "update_budget":
      return <Wallet className="w-4 h-4" />;
    case "update_wedding_date":
      return <Calendar className="w-4 h-4" />;
    case "update_task_status":
      return <CheckCircle2 className="w-4 h-4" />;
    case "update_venue":
      return <MapPin className="w-4 h-4" />;
    case "get_budget_summary":
      return <BarChart3 className="w-4 h-4" />;
    case "get_schedule_summary":
      return <ListChecks className="w-4 h-4" />;
    case "get_wedding_info":
      return <Info className="w-4 h-4" />;
    default:
      return <Info className="w-4 h-4" />;
  }
}

function getTitle(toolName: string) {
  switch (toolName) {
    case "update_budget":
      return "예산 변경";
    case "update_wedding_date":
      return "날짜 변경";
    case "update_task_status":
      return "일정 업데이트";
    case "update_venue":
      return "예식장 설정";
    case "get_budget_summary":
      return "예산 현황";
    case "get_schedule_summary":
      return "진행 현황";
    case "get_wedding_info":
      return "웨딩 정보";
    default:
      return "작업 완료";
  }
}

function getAccentColor(toolName: string) {
  if (toolName.startsWith("update_")) {
    return "border-[#C4967E]/30 bg-[#C4967E]/5";
  }
  return "border-[#C9A96E]/30 bg-[#C9A96E]/5";
}

export default function ActionCard({ result }: ActionCardProps) {
  // get_ 도구는 카드 표시 불필요 (AI가 텍스트로 안내)
  if (result.toolName.startsWith("get_")) return null;

  const icon = getIcon(result.toolName);
  const title = getTitle(result.toolName);
  const accentColor = getAccentColor(result.toolName);

  return (
    <div className="flex justify-start ml-12 my-2">
      <div
        className={`rounded-xl border ${accentColor} px-4 py-3 max-w-[320px] shadow-sm`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[#C4967E]">{icon}</span>
          <span className="text-xs font-semibold text-[#1A1A1F]">{title}</span>
          {result.success ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-400 ml-auto" />
          )}
        </div>
        <p className="text-xs text-[#928980] leading-relaxed">
          {result.displayMessage}
        </p>
      </div>
    </div>
  );
}
