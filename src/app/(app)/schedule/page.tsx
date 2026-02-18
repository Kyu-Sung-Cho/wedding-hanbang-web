"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Circle, Clock, ChevronDown, ChevronUp } from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

interface Task {
  title: string;
  desc: string;
  done: boolean;
}

interface TimelineItem {
  dday: string;
  period: string;
  category: string;
  tasks: Task[];
}

const timeline: TimelineItem[] = [
  {
    dday: "D-360 ~ D-300",
    period: "12~10개월 전",
    category: "초기 준비",
    tasks: [
      { title: "결혼 예산 설정", desc: "양가 상의 후 총 예산 확정", done: true },
      { title: "예식장 투어 및 계약", desc: "최소 3곳 이상 비교", done: true },
      { title: "웨딩 플래너 선정", desc: "AI 플래너 활용 가능", done: true },
    ],
  },
  {
    dday: "D-300 ~ D-180",
    period: "10~6개월 전",
    category: "핵심 계약",
    tasks: [
      { title: "스튜디오 계약", desc: "촬영 스타일, 보정본 수 확인", done: true },
      { title: "드레스 투어 시작", desc: "AI 가상 피팅으로 사전 비교", done: false },
      { title: "메이크업 업체 선정", desc: "리허설 포함 패키지 확인", done: false },
      { title: "예물 구매", desc: "반지, 시계 등 예산 내 결정", done: false },
    ],
  },
  {
    dday: "D-180 ~ D-90",
    period: "6~3개월 전",
    category: "세부 준비",
    tasks: [
      { title: "한복 맞춤/대여", desc: "양가 어머니 한복 포함", done: false },
      { title: "청첩장 제작", desc: "디자인 선정, 수량 결정", done: false },
      { title: "신혼여행 예약", desc: "항공권, 숙소 조기 예약 할인", done: false },
      { title: "혼수 준비", desc: "가전, 가구 리스트 작성", done: false },
    ],
  },
  {
    dday: "D-90 ~ D-30",
    period: "3~1개월 전",
    category: "마무리",
    tasks: [
      { title: "메이크업 리허설", desc: "최소 1회 필수", done: false },
      { title: "본식 리허설", desc: "식장 방문, 동선 확인", done: false },
      { title: "답례품 준비", desc: "수량: 하객 수 + 여유분", done: false },
      { title: "최종 하객 명단 확정", desc: "식대 인원 확정 통보", done: false },
    ],
  },
];

export default function SchedulePage() {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(1);
  const totalTasks = timeline.reduce((s, t) => s + t.tasks.length, 0);
  const doneTasks = timeline.reduce((s, t) => s + t.tasks.filter((tk) => tk.done).length, 0);

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 상단 요약 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl p-6 border border-black/[0.04] mb-8 flex items-center justify-between max-md:flex-col max-md:gap-4"
      >
        <div>
          <p className="text-[12px] text-taupe-500 font-light mb-1">전체 체크리스트</p>
          <p className="text-[14px] text-noir-800">
            <span className="font-display text-[28px] font-light text-rose-500">{doneTasks}</span>
            <span className="text-taupe-400 mx-1">/</span>
            <span className="font-display text-[28px] font-light text-taupe-400">{totalTasks}</span>
            <span className="text-[13px] text-taupe-400 ml-2">완료</span>
          </p>
        </div>
        <div className="w-[200px] max-md:w-full">
          <div className="h-3 bg-ivory-warm rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-500 to-gold rounded-full transition-all"
              style={{ width: `${Math.round((doneTasks / totalTasks) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-taupe-400 mt-1.5 text-right">
            {Math.round((doneTasks / totalTasks) * 100)}% 달성
          </p>
        </div>
      </motion.div>

      {/* 타임라인 */}
      <div className="relative">
        <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-rose-500 via-gold to-platinum max-md:left-[15px]" />

        {timeline.map((section, si) => {
          const isExpanded = expandedIdx === si;
          const sectionDone = section.tasks.filter((t) => t.done).length;
          const allDone = sectionDone === section.tasks.length;

          return (
            <motion.div
              key={section.dday}
              {...fadeIn}
              transition={{ duration: 0.5, delay: si * 0.08 }}
              className="relative pl-12 mb-4 max-md:pl-10"
            >
              {/* 타임라인 도트 */}
              <div className={`absolute left-[12px] top-[22px] w-[16px] h-[16px] rounded-full border-[3px] ${
                allDone
                  ? "border-[#2E7D5A] bg-[#2E7D5A]"
                  : sectionDone > 0
                  ? "border-rose-500 bg-white"
                  : "border-taupe-400 bg-white"
              } max-md:left-[8px] max-md:w-[14px] max-md:h-[14px]`} />

              <button
                onClick={() => setExpandedIdx(isExpanded ? null : si)}
                className="w-full bg-white rounded-2xl border border-black/[0.04] overflow-hidden hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-shadow"
              >
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-rose-500 bg-rose-500/10 px-2.5 py-1 rounded-full font-medium">
                      {section.dday}
                    </span>
                    <span className="text-[14px] font-medium text-noir-800">{section.category}</span>
                    <span className="text-[11px] text-taupe-400 font-light">{section.period}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-taupe-400">{sectionDone}/{section.tasks.length}</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-taupe-400" /> : <ChevronDown className="w-4 h-4 text-taupe-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-black/[0.03] px-5 pb-4">
                    {section.tasks.map((task, ti) => (
                      <div key={ti} className="flex items-start gap-3 py-3 border-b border-black/[0.02] last:border-0">
                        <div className="mt-0.5">
                          {task.done ? (
                            <Check className="w-5 h-5 text-[#2E7D5A]" />
                          ) : (
                            <Circle className="w-5 h-5 text-taupe-400" />
                          )}
                        </div>
                        <div className="text-left">
                          <p className={`text-[13px] font-medium ${task.done ? "text-taupe-400 line-through" : "text-noir-800"}`}>
                            {task.title}
                          </p>
                          <p className="text-[11px] text-taupe-400 font-light mt-0.5">{task.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
