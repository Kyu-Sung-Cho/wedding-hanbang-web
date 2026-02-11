"use client";

import { useState } from "react";
import {
  BookOpen, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  CheckCircle2, Circle, Lightbulb, AlertTriangle, MessageSquareQuote,
  Heart, Search, Bookmark, BookmarkCheck,
} from "lucide-react";
import { useEtiquetteStore } from "@/stores/etiquetteStore";
import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { EtiquettePart, EtiquetteSection } from "@/types/etiquette";
import Card from "@/components/ui/Card";

type ViewMode = "overview" | "part" | "section";

export default function EtiquettePage() {
  const {
    completedItems,
    bookmarks,
    toggleCheckItem,
    toggleBookmark,
    getPartProgress,
    getTotalProgress,
    isItemCompleted,
    isBookmarked,
  } = useEtiquetteStore();

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [selectedPart, setSelectedPart] = useState<EtiquettePart | null>(null);
  const [selectedSection, setSelectedSection] = useState<EtiquetteSection | null>(null);
  const [expandedTips, setExpandedTips] = useState<Set<string>>(new Set());
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(new Set());
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const totalProgress = getTotalProgress();

  // 파트 선택
  const handleSelectPart = (part: EtiquettePart) => {
    setSelectedPart(part);
    setSelectedSection(null);
    setViewMode("part");
  };

  // 섹션 선택
  const handleSelectSection = (section: EtiquetteSection) => {
    setSelectedSection(section);
    setViewMode("section");
  };

  // 뒤로가기
  const handleBack = () => {
    if (viewMode === "section") {
      setSelectedSection(null);
      setViewMode("part");
    } else if (viewMode === "part") {
      setSelectedPart(null);
      setViewMode("overview");
    }
  };

  // 토글 헬퍼
  const toggleSet = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  // === 개요 뷰 ===
  if (viewMode === "overview") {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {/* 헤더 */}
        <Card className="bg-gradient-to-r from-rose-500/5 to-gold/5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-glow">
              <BookOpen className="h-6 w-6 text-rose-500" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-medium text-noir-800">
                웨딩 예절 가이드
              </h2>
              <p className="text-sm text-taupe-500">
                결혼 준비의 모든 예절을 체크리스트로 관리하세요
              </p>
            </div>
          </div>
          {/* 전체 진행률 */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-taupe-500">전체 진행률</span>
              <span className="font-medium text-rose-500">
                {totalProgress.completed}/{totalProgress.total} ({totalProgress.percentage}%)
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-ivory-200">
              <div
                className="h-full rounded-full bg-rose-500 transition-all duration-300"
                style={{ width: `${totalProgress.percentage}%` }}
              />
            </div>
          </div>
        </Card>

        {/* 6파트 그리드 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ETIQUETTE_PARTS.map((part) => {
            const progress = getPartProgress(part.id);
            return (
              <Card
                key={part.id}
                padding="none"
                className="cursor-pointer transition-all hover:shadow-md"
                onClick={() => handleSelectPart(part)}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{part.icon}</span>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: part.color }}>
                          PART {part.partNumber}
                        </p>
                        <h3 className="text-sm font-medium text-noir-800">
                          {part.title}
                        </h3>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-taupe-400" />
                  </div>
                  <p className="mt-2 text-xs text-taupe-500">{part.subtitle}</p>
                  {/* 진행률 */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-taupe-400">
                        {progress.completed}/{progress.total}
                      </span>
                      <span className="font-medium" style={{ color: part.color }}>
                        {progress.percentage}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-ivory-200">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${progress.percentage}%`, backgroundColor: part.color }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* AI 상담 안내 */}
        <Card className="text-center">
          <Heart className="mx-auto mb-3 h-8 w-8 text-rose-500" />
          <h3 className="text-sm font-medium text-noir-800">
            더 궁금한 게 있으신가요?
          </h3>
          <p className="mt-1 text-xs text-taupe-500">
            AI 웨딩 플래너에게 자세히 물어보세요
          </p>
          <a
            href="/chat"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-600"
          >
            AI 상담하기
          </a>
        </Card>
      </div>
    );
  }

  // === 파트 뷰 ===
  if (viewMode === "part" && selectedPart) {
    const progress = getPartProgress(selectedPart.id);
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {/* 네비게이션 */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-taupe-500 hover:text-noir-800"
        >
          <ChevronLeft className="h-4 w-4" />
          전체 목록
        </button>

        {/* 파트 헤더 */}
        <Card
          className="border-l-4"
          style={{ borderLeftColor: selectedPart.color }}
        >
          <div className="flex items-center gap-3">
            <span className="text-4xl">{selectedPart.icon}</span>
            <div className="flex-1">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: selectedPart.color }}>
                PART {selectedPart.partNumber}
              </p>
              <h2 className="text-lg font-medium text-noir-800">{selectedPart.title}</h2>
              <p className="text-sm text-taupe-500">{selectedPart.subtitle}</p>
            </div>
            <button
              onClick={() => toggleBookmark(selectedPart.id)}
              className="rounded-lg p-2 hover:bg-ivory-100"
            >
              {isBookmarked(selectedPart.id) ? (
                <BookmarkCheck className="h-5 w-5 text-gold" />
              ) : (
                <Bookmark className="h-5 w-5 text-taupe-400" />
              )}
            </button>
          </div>
          <p className="mt-3 text-sm text-taupe-500">{selectedPart.description}</p>
          {/* 진행률 */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-taupe-500">진행률</span>
              <span className="font-medium" style={{ color: selectedPart.color }}>
                {progress.completed}/{progress.total} ({progress.percentage}%)
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-ivory-200">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress.percentage}%`, backgroundColor: selectedPart.color }}
              />
            </div>
          </div>
        </Card>

        {/* 섹션 목록 */}
        <div className="space-y-3">
          {selectedPart.sections.map((section, idx) => {
            let sectionTotal = 0;
            let sectionCompleted = 0;
            for (const group of section.checklists) {
              for (const item of group.items) {
                sectionTotal++;
                if (completedItems[item.id]) sectionCompleted++;
              }
            }

            return (
              <Card
                key={section.id}
                padding="none"
                className="cursor-pointer transition-all hover:shadow-md"
                onClick={() => handleSelectSection(section)}
              >
                <div className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-white"
                      style={{ backgroundColor: selectedPart.color }}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-noir-800">{section.title}</h3>
                      <p className="text-xs text-taupe-400">
                        체크 {sectionCompleted}/{sectionTotal} · 팁 {section.tips.length} · 주의 {section.warnings.length}
                        {section.scripts.length > 0 && ` · 스크립트 ${section.scripts.length}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {sectionTotal > 0 && (
                      <span className="text-xs font-medium" style={{ color: selectedPart.color }}>
                        {Math.round((sectionCompleted / sectionTotal) * 100)}%
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-taupe-400" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // === 섹션 상세 뷰 ===
  if (viewMode === "section" && selectedPart && selectedSection) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {/* 네비게이션 */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-taupe-500 hover:text-noir-800"
        >
          <ChevronLeft className="h-4 w-4" />
          {selectedPart.title}
        </button>

        {/* 섹션 헤더 */}
        <Card style={{ borderLeft: `4px solid ${selectedPart.color}` }}>
          <h2 className="text-lg font-medium text-noir-800">{selectedSection.title}</h2>
          <p className="mt-1 text-xs text-taupe-400">
            Part {selectedPart.partNumber} - {selectedPart.title}
          </p>
        </Card>

        {/* 체크리스트 */}
        {selectedSection.checklists.map((group) => (
          <Card key={group.id} padding="none">
            <div className="border-b border-platinum px-5 py-3">
              <h3 className="text-sm font-medium text-noir-800">{group.groupTitle}</h3>
            </div>
            <div className="divide-y divide-platinum">
              {group.items.map((item) => {
                const completed = isItemCompleted(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleCheckItem(item.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-ivory-50"
                  >
                    {completed ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: selectedPart.color }} />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-taupe-400" />
                    )}
                    <span
                      className={`text-sm ${
                        completed ? "text-taupe-400 line-through" : "text-noir-800"
                      }`}
                    >
                      {item.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        ))}

        {/* 팁 */}
        {selectedSection.tips.map((tip) => (
          <Card key={tip.id} padding="none">
            <button
              onClick={() => toggleSet(expandedTips, tip.id, setExpandedTips)}
              className="flex w-full items-center justify-between px-5 py-4"
            >
              <div className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                <span className="text-sm font-medium text-noir-800">{tip.title}</span>
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] text-yellow-700">
                  팁 {tip.items.length}
                </span>
              </div>
              {expandedTips.has(tip.id) ? (
                <ChevronUp className="h-4 w-4 text-taupe-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-taupe-400" />
              )}
            </button>
            {expandedTips.has(tip.id) && (
              <div className="border-t border-platinum px-5 pb-4">
                <div className="space-y-4 pt-3">
                  {tip.items.map((tipItem) => (
                    <div key={tipItem.number} className="rounded-xl bg-yellow-50 p-4">
                      <p className="text-sm font-medium text-noir-800">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-white">
                          {tipItem.number}
                        </span>
                        {tipItem.title}
                      </p>
                      <p className="mt-1.5 text-xs leading-relaxed text-taupe-500">
                        {tipItem.description}
                      </p>
                      {tipItem.subItems && tipItem.subItems.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {tipItem.subItems.map((sub, idx) => (
                            <li key={idx} className="text-xs text-taupe-500">
                              · {sub}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}

        {/* 주의사항 */}
        {selectedSection.warnings.map((warning) => (
          <Card key={warning.id} padding="none">
            <button
              onClick={() => toggleSet(expandedWarnings, warning.id, setExpandedWarnings)}
              className="flex w-full items-center justify-between px-5 py-4"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <span className="text-sm font-medium text-noir-800">{warning.title}</span>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700">
                  주의 {warning.items.length}
                </span>
              </div>
              {expandedWarnings.has(warning.id) ? (
                <ChevronUp className="h-4 w-4 text-taupe-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-taupe-400" />
              )}
            </button>
            {expandedWarnings.has(warning.id) && (
              <div className="border-t border-platinum px-5 pb-4">
                <div className="space-y-2 pt-3">
                  {warning.items.map((item, idx) => (
                    <div key={idx} className="flex gap-2 rounded-xl bg-red-50 p-3">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                      <p className="text-xs leading-relaxed text-red-700">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}

        {/* 스크립트 */}
        {selectedSection.scripts.map((script) => (
          <Card key={script.id} padding="none">
            <button
              onClick={() => toggleSet(expandedScripts, script.id, setExpandedScripts)}
              className="flex w-full items-center justify-between px-5 py-4"
            >
              <div className="flex items-center gap-2">
                <MessageSquareQuote className="h-5 w-5 text-blue-500" />
                <span className="text-sm font-medium text-noir-800">{script.title}</span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                  스크립트
                </span>
              </div>
              {expandedScripts.has(script.id) ? (
                <ChevronUp className="h-4 w-4 text-taupe-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-taupe-400" />
              )}
            </button>
            {expandedScripts.has(script.id) && (
              <div className="border-t border-platinum px-5 pb-4">
                <div className="mt-3 space-y-2 rounded-xl bg-blue-50 p-4">
                  {script.lines.map((line, idx) => (
                    <p key={idx} className="text-xs leading-relaxed text-blue-800">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    );
  }

  return null;
}
