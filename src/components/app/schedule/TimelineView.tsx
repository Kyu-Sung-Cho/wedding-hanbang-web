"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Check, Circle, ChevronDown, ChevronUp } from "lucide-react";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, getChecklistCounts } from "@/utils/checklist";
import type { ProgressItem } from "@/types/database.types";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

interface Task {
  key: string;
  title: string;
  desc: string;
}

interface TimelineSection {
  dday: string;
  period: string;
  category: string;
  tasks: Task[];
}

const TIMELINE_TEMPLATE: TimelineSection[] = [
  {
    dday: "D-360 ~ D-300",
    period: "12~10개월 전",
    category: "초기 준비",
    tasks: [
      { key: "venue", title: "예식장 투어 및 계약", desc: "최소 3곳 이상 비교" },
      { key: "_budget_plan", title: "결혼 예산 설정", desc: "양가 상의 후 총 예산 확정" },
      { key: "_planner", title: "웨딩 플래너 선정", desc: "AI 플래너 활용 가능" },
    ],
  },
  {
    dday: "D-300 ~ D-180",
    period: "10~6개월 전",
    category: "핵심 계약",
    tasks: [
      { key: "studio", title: "스튜디오 계약", desc: "촬영 스타일, 보정본 수 확인" },
      { key: "dress", title: "드레스 투어 시작", desc: "AI 가상 피팅으로 사전 비교" },
      { key: "makeup", title: "메이크업 업체 선정", desc: "리허설 포함 패키지 확인" },
      { key: "ring", title: "예물 구매", desc: "반지, 시계 등 예산 내 결정" },
    ],
  },
  {
    dday: "D-180 ~ D-90",
    period: "6~3개월 전",
    category: "세부 준비",
    tasks: [
      { key: "hanbok", title: "한복 맞춤/대여", desc: "양가 어머니 한복 포함" },
      { key: "invitation", title: "청첩장 제작", desc: "디자인 선정, 수량 결정" },
      { key: "honeymoon", title: "신혼여행 예약", desc: "항공권, 숙소 조기 예약 할인" },
      { key: "houseware", title: "혼수 준비", desc: "가전, 가구 리스트 작성" },
    ],
  },
  {
    dday: "D-90 ~ D-30",
    period: "3~1개월 전",
    category: "마무리",
    tasks: [
      { key: "_rehearsal_makeup", title: "메이크업 리허설", desc: "최소 1회 필수" },
      { key: "_rehearsal_wedding", title: "본식 리허설", desc: "식장 방문, 동선 확인" },
      { key: "gift", title: "답례품 준비", desc: "수량: 하객 수 + 여유분" },
      { key: "_guest_list", title: "최종 하객 명단 확정", desc: "식대 인원 확정 통보" },
    ],
  },
];

interface Props {
  progress: Record<string, ProgressItem>;
  onCategoryClick: (key: string) => void;
}

export default function TimelineView({ progress, onCategoryClick }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  const getTaskStatus = useCallback(
    (key: string): string => {
      if (key.startsWith("_")) return "not_started";
      const item = progress[key] as { status: string } | undefined;
      return item?.status ?? "not_started";
    },
    [progress]
  );

  const isTaskDone = useCallback(
    (key: string): boolean => getTaskStatus(key) === "completed",
    [getTaskStatus]
  );

  return (
    <div className="relative">
      <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-rose-500 via-gold to-platinum max-md:left-[15px]" />

      {TIMELINE_TEMPLATE.map((section, si) => {
        const isExpanded = expandedIdx === si;
        const sectionDone = section.tasks.filter((t) => isTaskDone(t.key)).length;
        const allDone = sectionDone === section.tasks.length;

        return (
          <motion.div
            key={section.dday}
            {...fadeIn}
            transition={{ duration: 0.5, delay: si * 0.08 }}
            className="relative pl-12 mb-4 max-md:pl-10"
          >
            <div
              className={`absolute left-[12px] top-[22px] w-[16px] h-[16px] rounded-full border-[3px] ${
                allDone
                  ? "border-[#2E7D5A] bg-[#2E7D5A]"
                  : sectionDone > 0
                  ? "border-rose-500 bg-white"
                  : "border-taupe-400 bg-white"
              } max-md:left-[8px] max-md:w-[14px] max-md:h-[14px]`}
            />

            <div className="w-full bg-white rounded-2xl border border-black/[0.04] overflow-hidden hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-shadow">
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : si)}
                className="w-full flex items-center justify-between px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                    {section.dday}
                  </span>
                  <span className="text-[14px] font-medium text-noir-800">
                    {section.category}
                  </span>
                  <span className="text-[11px] text-taupe-400 font-light">
                    {section.period}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-taupe-400">
                    {sectionDone}/{section.tasks.length}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-taupe-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-taupe-400" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-black/[0.03] px-5 pb-4">
                  {section.tasks.map((task, ti) => {
                    const done = isTaskDone(task.key);
                    const isCategory = !task.key.startsWith("_");
                    const template = isCategory ? CHECKLIST_MAP[task.key] : null;
                    const existing = isCategory ? progress[task.key] : undefined;
                    const merged = template
                      ? mergeChecklist(template.items, existing?.checklist)
                      : [];
                    const { done: checkDone, total: checkTotal } =
                      getChecklistCounts(merged);

                    return (
                      <div
                        key={ti}
                        onClick={() => isCategory && onCategoryClick(task.key)}
                        className={`flex items-start gap-3 py-3 border-b border-black/[0.02] last:border-0 ${
                          isCategory
                            ? "cursor-pointer hover:bg-ivory-50 -mx-2 px-2 rounded-lg transition-colors"
                            : ""
                        }`}
                      >
                        <div className="mt-0.5">
                          {done ? (
                            <Check className="w-5 h-5 text-[#2E7D5A]" />
                          ) : (
                            <Circle
                              className={`w-5 h-5 ${
                                isCategory
                                  ? "text-taupe-400 hover:text-rose-500"
                                  : "text-taupe-300"
                              }`}
                            />
                          )}
                        </div>
                        <div className="text-left flex-1">
                          <p
                            className={`text-[13px] font-medium ${
                              done
                                ? "text-taupe-400 line-through"
                                : "text-noir-800"
                            }`}
                          >
                            {task.title}
                          </p>
                          <p className="text-[11px] text-taupe-400 font-light mt-0.5">
                            {task.desc}
                          </p>
                        </div>
                        {isCategory && (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {checkTotal > 0 && (
                              <span className="text-[10px] text-taupe-400">
                                {checkDone}/{checkTotal}
                              </span>
                            )}
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full ${
                                done
                                  ? "bg-[#2E7D5A]/10 text-[#2E7D5A]"
                                  : getTaskStatus(task.key) === "in_progress"
                                  ? "bg-rose-500/10 text-rose-500"
                                  : "bg-taupe-400/10 text-taupe-400"
                              }`}
                            >
                              {done
                                ? "완료"
                                : getTaskStatus(task.key) === "in_progress"
                                ? "진행중"
                                : "진행전"}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
