"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Heart, Users, Gem, Mail, Landmark, Plane, Crown, Home,
  Banknote, CalendarDays, DoorOpen, Camera, UserCheck, Mic,
  Gift, MessageCircle, FileText, Handshake, Building,
  Smartphone, Clock, Sparkles, TreePine, HeartHandshake,
  PiggyBank, ChevronRight, Search, BookOpen, ArrowLeft,
  CheckCircle2, Lightbulb, AlertTriangle, MessageSquareQuote,
  ListOrdered, ChevronDown, Square, CheckSquare, CalendarPlus, X, Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ETIQUETTE_PARTS, ETIQUETTE_CATEGORIES } from "@/constants/etiquetteData";
import { useAuthStore } from "@/stores/authStore";
import { addEvent } from "@/utils/scheduleEvents";

// 아이콘 맵
const ICON_MAP: Record<string, LucideIcon> = {
  Heart, Users, Gem, Mail, Church: Landmark, Plane, Crown, Home,
  Banknote, Calendar: CalendarDays, DoorOpen, Camera, UserCheck, Mic,
  Gift, MessageCircle, FileText, Handshake, Building,
  Smartphone, Clock, Sparkles, TreePine, HeartHandshake, PiggyBank,
  BookOpen, Landmark,
};

// 마크다운 콘텐츠 파서
interface ParsedSection {
  title: string;
  emoji?: string;
  blocks: ParsedBlock[];
}

interface ParsedBlock {
  type: "checklist" | "tips" | "warning" | "dialogue" | "steps" | "paragraph" | "heading";
  title?: string;
  items: ParsedItem[];
}

interface ParsedItem {
  type: "group-title" | "list-item" | "numbered" | "text" | "dialogue-speaker" | "dialogue-text" | "arrow";
  text: string;
  subItems?: string[];
}

function parseContent(content: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  // Split by ### headers (section level)
  const sectionParts = content.split(/\n### /);

  for (let i = 0; i < sectionParts.length; i++) {
    const part = sectionParts[i].trim();
    if (!part) continue;

    let title = "";
    let emoji = "";
    let body = part;

    if (i > 0) {
      // Extract section title
      const titleEnd = part.indexOf("\n");
      const rawTitle = titleEnd > -1 ? part.substring(0, titleEnd) : part;
      body = titleEnd > -1 ? part.substring(titleEnd + 1) : "";

      // Extract emoji from title
      const emojiMatch = rawTitle.match(/([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/u);
      emoji = emojiMatch ? emojiMatch[1] : "";
      title = rawTitle.replace(/([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu, "").trim();
    } else {
      // First section (before any ### header) - may just be description
      const firstLine = part.split("\n")[0];
      if (!firstLine.startsWith("####") && !firstLine.startsWith("**") && !firstLine.startsWith("-")) {
        // Skip the description paragraph (already shown in header)
        continue;
      }
    }

    const blocks = parseBlocks(body);
    if (blocks.length > 0 || title) {
      sections.push({ title, emoji, blocks });
    }
  }

  return sections;
}

function parseBlocks(body: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  // Split by #### headers (subsection level)
  const subParts = body.split(/\n#### /);

  for (let i = 0; i < subParts.length; i++) {
    const sub = subParts[i].trim();
    if (!sub) continue;

    if (i === 0 && !body.trimStart().startsWith("#### ")) {
      // Content before any #### header - parse as generic content
      const items = parseItems(sub);
      if (items.length > 0) {
        blocks.push({ type: "paragraph", items });
      }
      continue;
    }

    const titleEnd = sub.indexOf("\n");
    const rawTitle = (titleEnd > -1 ? sub.substring(0, titleEnd) : sub).trim();
    const blockBody = titleEnd > -1 ? sub.substring(titleEnd + 1).trim() : "";

    // Determine block type from title
    let type: ParsedBlock["type"] = "paragraph";
    if (rawTitle.includes("🔥") || rawTitle.includes("꿀팁")) {
      type = "tips";
    } else if (rawTitle.includes("⚠️") || rawTitle.includes("주의") || rawTitle.includes("금기") || rawTitle.includes("금물") || rawTitle.includes("절대") || rawTitle.includes("피해야")) {
      type = "warning";
    } else if (rawTitle.includes("💬") || rawTitle.includes("대사") || rawTitle.includes("인사말")) {
      type = "dialogue";
    } else if (rawTitle.includes("체크리스트") || rawTitle.includes("체크")) {
      type = "checklist";
    } else if (rawTitle.includes("순서") || rawTitle.includes("절차") || rawTitle.includes("하는 법")) {
      type = "steps";
    } else if (rawTitle.includes("기본") || rawTitle.includes("원칙") || rawTitle.includes("분담") || rawTitle.includes("가이드") || rawTitle.includes("구성") || rawTitle.includes("분류")) {
      type = "checklist";
    }

    const cleanTitle = rawTitle.replace(/[🔥⚠️💬]/g, "").trim();
    const items = parseItems(blockBody);
    if (items.length > 0) {
      blocks.push({ type, title: cleanTitle, items });
    }
  }

  return blocks;
}

function parseItems(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Bold group title: **Title**
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      items.push({
        type: "group-title",
        text: trimmed.replace(/\*\*/g, ""),
      });
      continue;
    }

    // Numbered item: 1. "Title" or 1. Title
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      const mainText = numMatch[2];
      // Collect sub-items (indented lines after this)
      const subItems: string[] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed && !nextTrimmed.match(/^\d+\./) && !nextTrimmed.startsWith("**") && !nextTrimmed.startsWith("- ") && (nextLine.startsWith("   ") || nextLine.startsWith("\t") || nextTrimmed.startsWith("→"))) {
          subItems.push(nextTrimmed);
          i++;
        } else {
          break;
        }
      }
      items.push({ type: "numbered", text: mainText, subItems });
      continue;
    }

    // List item: - Item text
    if (trimmed.startsWith("- ")) {
      items.push({ type: "list-item", text: trimmed.substring(2) });
      continue;
    }

    // Arrow line (sub-tip)
    if (trimmed.startsWith("→ ")) {
      items.push({ type: "arrow", text: trimmed.substring(2) });
      continue;
    }

    // Dialogue speaker: **Speaker:**
    if (trimmed.startsWith("**") && trimmed.includes(":**")) {
      const speaker = trimmed.replace(/\*\*/g, "").replace(/:$/, "");
      // Collect dialogue text
      const dialogueLines: string[] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith("**")) {
          dialogueLines.push(nextLine);
          i++;
        } else {
          break;
        }
      }
      items.push({ type: "dialogue-speaker", text: speaker });
      if (dialogueLines.length > 0) {
        items.push({ type: "dialogue-text", text: dialogueLines.join("\n") });
      }
      continue;
    }

    // Regular text/paragraph
    items.push({ type: "text", text: trimmed });
  }

  return items;
}

// 인라인 텍스트 포맷 (볼드, 따옴표 등)
function formatInlineText(text: string) {
  const parts: (string | React.ReactElement)[] = [];
  // Handle **bold** and "quoted" text
  const regex = /(\*\*(.+?)\*\*)|("(.+?)")|("(.+?)")/g;
  let lastIndex = 0;
  let match;

  const str = text;
  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parts.push(str.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(<strong key={match.index} className="font-medium text-noir-800">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<span key={match.index} className="text-rose-500 font-medium">{match[4]}</span>);
    } else if (match[5]) {
      parts.push(<span key={match.index} className="text-rose-500 font-medium">{match[6]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < str.length) {
    parts.push(str.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

// 블록 렌더러
function BlockRenderer({ block, blockId, checkedItems, onToggleCheck, onOpenSchedule }: {
  block: ParsedBlock;
  blockId: string;
  checkedItems: Set<string>;
  onToggleCheck: (itemId: string) => void;
  onOpenSchedule: (itemId: string, text: string) => void;
}) {
  const { type, title, items } = block;

  const blockStyles: Record<string, { bg: string; border: string; icon: LucideIcon; iconColor: string; titleColor: string }> = {
    checklist: { bg: "bg-white", border: "border-black/[0.04]", icon: CheckCircle2, iconColor: "text-emerald-500", titleColor: "text-noir-800" },
    tips: { bg: "bg-amber-50/60", border: "border-amber-200/50", icon: Lightbulb, iconColor: "text-amber-500", titleColor: "text-amber-700" },
    warning: { bg: "bg-red-50/50", border: "border-red-200/50", icon: AlertTriangle, iconColor: "text-red-400", titleColor: "text-red-700" },
    dialogue: { bg: "bg-sky-50/50", border: "border-sky-200/50", icon: MessageSquareQuote, iconColor: "text-sky-500", titleColor: "text-sky-700" },
    steps: { bg: "bg-violet-50/50", border: "border-violet-200/50", icon: ListOrdered, iconColor: "text-violet-500", titleColor: "text-violet-700" },
    paragraph: { bg: "bg-white", border: "border-black/[0.04]", icon: BookOpen, iconColor: "text-taupe-400", titleColor: "text-noir-800" },
    heading: { bg: "bg-white", border: "border-black/[0.04]", icon: BookOpen, iconColor: "text-taupe-400", titleColor: "text-noir-800" },
  };

  const style = blockStyles[type] || blockStyles.paragraph;
  const Icon = style.icon;

  return (
    <div className={`rounded-xl ${style.bg} border ${style.border} p-5 max-md:p-4`}>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          <Icon className={`w-4 h-4 ${style.iconColor} flex-shrink-0`} />
          <h4 className={`text-[14px] font-medium ${style.titleColor}`}>{title}</h4>
        </div>
      )}
      <div className="space-y-1.5">
        {items.map((item, idx) => {
          const itemId = `${blockId}_${idx}`;
          return (
            <ItemRenderer
              key={idx}
              item={item}
              blockType={type}
              itemId={itemId}
              isChecked={checkedItems.has(itemId)}
              onToggleCheck={onToggleCheck}
              onOpenSchedule={onOpenSchedule}
            />
          );
        })}
      </div>
    </div>
  );
}

function ItemRenderer({ item, blockType, itemId, isChecked, onToggleCheck, onOpenSchedule }: {
  item: ParsedItem;
  blockType: string;
  itemId: string;
  isChecked: boolean;
  onToggleCheck: (itemId: string) => void;
  onOpenSchedule: (itemId: string, text: string) => void;
}) {
  switch (item.type) {
    case "group-title":
      return (
        <div className="pt-2 pb-1 first:pt-0">
          <p className="text-[13px] font-semibold text-noir-800">{item.text}</p>
        </div>
      );

    case "list-item":
      if (blockType === "warning") {
        return (
          <div className="flex gap-2 pl-1">
            <span className="text-red-400 mt-0.5 text-[12px] flex-shrink-0">&#x2716;</span>
            <p className="text-[13px] text-charcoal font-light leading-[1.7]">
              {formatInlineText(item.text)}
            </p>
          </div>
        );
      }
      return (
        <div className="flex items-start gap-2 pl-1 group/item">
          <button
            onClick={() => onToggleCheck(itemId)}
            className="mt-0.5 flex-shrink-0 transition-colors"
          >
            {isChecked ? (
              <CheckSquare className="w-4 h-4 text-emerald-500" />
            ) : (
              <Square className="w-4 h-4 text-taupe-400 group-hover/item:text-taupe-500" />
            )}
          </button>
          <p className={`text-[13px] font-light leading-[1.7] flex-1 transition-colors ${isChecked ? "text-taupe-400 line-through" : "text-charcoal"}`}>
            {formatInlineText(item.text)}
          </p>
          {(blockType === "checklist" || blockType === "steps" || blockType === "paragraph") && (
            <button
              onClick={() => onOpenSchedule(itemId, item.text)}
              className="mt-0.5 flex-shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
              title="일정에 추가"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-taupe-400 hover:text-rose-500 transition-colors" />
            </button>
          )}
        </div>
      );

    case "numbered": {
      const numMatch = item.text.match(/^"(.+?)"/);
      return (
        <div className="pl-1 py-1.5">
          <div className="flex gap-2">
            <span className={`text-[12px] font-semibold mt-0.5 flex-shrink-0 ${blockType === "tips" ? "text-amber-500" : blockType === "steps" ? "text-violet-500" : "text-rose-500"}`}>
              {item.subItems ? "•" : "•"}
            </span>
            <div>
              <p className="text-[13px] text-noir-800 font-medium leading-[1.7]">
                {formatInlineText(item.text)}
              </p>
              {item.subItems && item.subItems.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {item.subItems.map((sub, i) => (
                    <p key={i} className={`text-[12px] font-light leading-[1.7] ${sub.startsWith("→") ? "text-taupe-500 pl-2" : "text-charcoal"}`}>
                      {formatInlineText(sub)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    case "dialogue-speaker":
      return (
        <div className="pt-2 first:pt-0">
          <p className="text-[13px] font-semibold text-sky-600">{item.text}</p>
        </div>
      );

    case "dialogue-text":
      return (
        <div className="bg-white/60 rounded-lg px-3 py-2 ml-0 border-l-2 border-sky-200">
          {item.text.split("\n").map((line, i) => (
            <p key={i} className="text-[13px] text-charcoal font-light leading-[1.8] italic">
              {formatInlineText(line)}
            </p>
          ))}
        </div>
      );

    case "arrow":
      return (
        <p className="text-[12px] text-taupe-500 font-light pl-4 leading-[1.7]">
          → {formatInlineText(item.text)}
        </p>
      );

    case "text":
    default:
      return (
        <p className="text-[13px] text-charcoal font-light leading-[1.8]">
          {formatInlineText(item.text)}
        </p>
      );
  }
}

// 일정 추가 팝오버
function SchedulePopover({ itemText, onClose, onSave }: {
  itemText: string;
  onClose: () => void;
  onSave: (date: string, memo: string) => void;
}) {
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState(itemText);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div ref={popoverRef} className="w-[300px] bg-white rounded-xl border border-black/[0.08] shadow-lg p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] font-medium text-noir-800">일정에 추가</p>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-ivory-200 transition-colors">
          <X className="w-3.5 h-3.5 text-taupe-400" />
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] text-taupe-500 mb-1">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-black/[0.06] text-[13px] text-noir-800 focus:outline-none focus:border-rose-500/30 focus:ring-1 focus:ring-rose-500/20 transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] text-taupe-500 mb-1">메모</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모 (선택)"
            className="w-full px-3 py-2 rounded-lg border border-black/[0.06] text-[13px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500/30 focus:ring-1 focus:ring-rose-500/20 transition-colors"
          />
        </div>
        <button
          onClick={() => {
            if (!date) return;
            onSave(date, memo);
          }}
          disabled={!date}
          className="w-full py-2 rounded-lg bg-rose-500 text-white text-[13px] font-medium hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          일정에 추가
        </button>
      </div>
    </div>
  );
}

export default function EtiquettePage() {
  const [selectedPart, setSelectedPart] = useState(0);
  const [selectedSection, setSelectedSection] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [schedulePopover, setSchedulePopover] = useState<{ itemId: string; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);

  const { journey, updateJourney } = useAuthStore();
  const part = ETIQUETTE_PARTS[selectedPart];
  const PartIcon = ICON_MAP[part.icon] || BookOpen;

  // localStorage에서 체크 상태 로드
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`etiquette_checks_${part.number}`);
      if (saved) {
        setCheckedItems(new Set(JSON.parse(saved)));
      } else {
        setCheckedItems(new Set());
      }
    } catch {
      setCheckedItems(new Set());
    }
  }, [part.number]);

  // 체크 상태 토글
  const handleToggleCheck = useCallback((itemId: string) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      try {
        localStorage.setItem(`etiquette_checks_${part.number}`, JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });
  }, [part.number]);

  // 일정 추가 팝오버 열기
  const handleOpenSchedule = useCallback((itemId: string, text: string) => {
    setSchedulePopover({ itemId, text });
  }, []);

  // 일정 저장
  const handleSaveSchedule = useCallback(async (date: string, memo: string) => {
    if (!journey?.progress) return;
    const progress = journey.progress as unknown as Record<string, unknown>;
    const { newProgress } = addEvent(progress, {
      date,
      title: memo || schedulePopover?.text || "예절 가이드 항목",
      memo: `예절 가이드 Part ${part.number}: ${part.title}`,
      categoryKey: "etiquette",
    });
    await updateJourney({ progress: newProgress as typeof journey.progress });
    setSchedulePopover(null);
    setToast("일정에 추가되었습니다");
  }, [journey, updateJourney, schedulePopover, part.number, part.title]);

  // 토스트 자동 닫기
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 파트 선택 시 콘텐츠 스크롤 맨 위로 + 섹션 초기화
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    setSelectedSection(null);
    setSchedulePopover(null);
  }, [selectedPart]);

  // 섹션 선택 시 스크롤 맨 위로
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [selectedSection]);

  // 검색 필터
  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return ETIQUETTE_PARTS;
    const q = searchQuery.toLowerCase();
    return ETIQUETTE_PARTS.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // 콘텐츠 파싱 (메모이제이션)
  const parsedSections = useMemo(() => parseContent(part.content), [part.content]);

  // 섹션이 1개 이하면 바로 콘텐츠 표시
  const hasSectionNav = parsedSections.length > 1;

  const selectPart = (partNumber: number) => {
    const idx = ETIQUETTE_PARTS.findIndex((p) => p.number === partNumber);
    if (idx >= 0) {
      setSelectedPart(idx);
      setSelectedSection(null);
      setSidebarOpen(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] max-md:h-[calc(100vh-56px)] overflow-hidden">
      {/* 사이드바 (데스크톱) */}
      <aside className="hidden lg:flex flex-col w-[280px] border-r border-black/[0.04] bg-ivory-50/50 flex-shrink-0">
        {/* 검색 */}
        <div className="p-4 border-b border-black/[0.04]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-taupe-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[13px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500/30 focus:ring-1 focus:ring-rose-500/20 transition-colors"
            />
          </div>
        </div>

        {/* 파트 목록 */}
        <div className="flex-1 overflow-y-auto py-2">
          {searchQuery ? (
            // 검색 결과
            <div className="px-2">
              {filteredParts.length === 0 && (
                <p className="text-[13px] text-taupe-400 text-center py-8">검색 결과가 없습니다</p>
              )}
              {filteredParts.map((p) => {
                const Icon = ICON_MAP[p.icon] || BookOpen;
                const isActive = ETIQUETTE_PARTS[selectedPart].number === p.number;
                return (
                  <button
                    key={p.number}
                    onClick={() => selectPart(p.number)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-0.5 ${
                      isActive ? "bg-rose-500/10 text-rose-600" : "hover:bg-white text-noir-800"
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[13px] font-medium truncate ${isActive ? "text-rose-600" : ""}`}>
                        {p.title}
                      </p>
                      <p className="text-[11px] text-taupe-400 truncate">{p.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            // 카테고리별 목록
            ETIQUETTE_CATEGORIES.map((cat) => (
              <div key={cat.label} className="mb-2">
                <p className="px-4 py-1.5 text-[11px] font-semibold text-taupe-400 uppercase tracking-wider">
                  {cat.label}
                </p>
                <div className="px-2">
                  {cat.parts.map((num) => {
                    const p = ETIQUETTE_PARTS.find((ep) => ep.number === num);
                    if (!p) return null;
                    const Icon = ICON_MAP[p.icon] || BookOpen;
                    const isActive = ETIQUETTE_PARTS[selectedPart].number === p.number;
                    return (
                      <button
                        key={p.number}
                        onClick={() => selectPart(p.number)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors mb-0.5 ${
                          isActive ? "bg-rose-500/10 text-rose-600" : "hover:bg-white text-noir-800"
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                          <Icon className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className={`text-[13px] font-medium truncate ${isActive ? "text-rose-600" : ""}`}>
                            {p.title}
                          </p>
                        </div>
                        {isActive && <ChevronRight className="w-3.5 h-3.5 text-rose-400 ml-auto flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 모바일 사이드바 오버레이 */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-[300px] bg-ivory-50 flex flex-col h-full animate-fade-in">
            <div className="p-4 border-b border-black/[0.04] flex items-center justify-between">
              <p className="text-[14px] font-medium text-noir-800">전체 목록</p>
              <button onClick={() => setSidebarOpen(false)} className="p-1">
                <ArrowLeft className="w-5 h-5 text-taupe-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {ETIQUETTE_CATEGORIES.map((cat) => (
                <div key={cat.label} className="mb-2">
                  <p className="px-4 py-1.5 text-[11px] font-semibold text-taupe-400 uppercase tracking-wider">
                    {cat.label}
                  </p>
                  <div className="px-2">
                    {cat.parts.map((num) => {
                      const p = ETIQUETTE_PARTS.find((ep) => ep.number === num);
                      if (!p) return null;
                      const Icon = ICON_MAP[p.icon] || BookOpen;
                      const isActive = ETIQUETTE_PARTS[selectedPart].number === p.number;
                      return (
                        <button
                          key={p.number}
                          onClick={() => selectPart(p.number)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-0.5 ${
                            isActive ? "bg-rose-500/10 text-rose-600" : "hover:bg-white text-noir-800"
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                            <Icon className="w-3.5 h-3.5 text-white" />
                          </div>
                          <p className={`text-[13px] font-medium truncate ${isActive ? "text-rose-600" : ""}`}>
                            {p.title}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {/* 콘텐츠 영역 */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {/* 모바일 헤더 + 가로 스크롤 pills */}
        <div className="lg:hidden sticky top-0 z-10 bg-ivory-50/95 backdrop-blur-sm border-b border-black/[0.04]">
          <div className="flex items-center gap-2 px-4 pt-3 pb-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg hover:bg-white border border-black/[0.06] flex-shrink-0"
            >
              <BookOpen className="w-4 h-4 text-taupe-500" />
            </button>
            <div
              ref={pillsRef}
              className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1"
            >
              {ETIQUETTE_PARTS.map((p, idx) => {
                const isActive = selectedPart === idx;
                return (
                  <button
                    key={p.number}
                    onClick={() => setSelectedPart(idx)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                      isActive
                        ? "bg-rose-500 text-white"
                        : "bg-white text-taupe-500 border border-black/[0.06]"
                    }`}
                  >
                    {p.title.replace(/ 예절| 에티켓| 총정리| & 법적 절차/g, "")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 파트 헤더 */}
        <div className="max-w-[800px] mx-auto px-6 max-md:px-4 pt-8 max-md:pt-5 pb-6">
          <div className="animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-12 h-12 max-md:w-10 max-md:h-10 rounded-xl bg-gradient-to-br ${part.color} flex items-center justify-center`}>
                <PartIcon className="w-6 h-6 max-md:w-5 max-md:h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-taupe-400 bg-taupe-400/10 px-2 py-0.5 rounded-full">
                    Part {part.number}
                  </span>
                </div>
                <h1 className="font-serif-kr text-[24px] max-md:text-[20px] font-light text-noir-800 leading-tight">
                  {part.title}
                </h1>
              </div>
            </div>
            <p className="text-[14px] max-md:text-[13px] text-taupe-500 font-light mb-1">
              {part.subtitle}
            </p>
            <p className="text-[13px] text-charcoal/70 font-light leading-[1.7]">
              {part.description}
            </p>
          </div>

          {/* 섹션 네비게이션 or 콘텐츠 */}
          {hasSectionNav && selectedSection === null ? (
            /* 섹션 선택 카드 */
            <div className="mt-8 animate-fade-in">
              <p className="text-[13px] text-taupe-500 font-light mb-4">
                항목을 선택하세요
              </p>
              <div className="grid gap-3">
                {parsedSections.map((section, sIdx) => {
                  // 블록 수 요약
                  const checklistCount = section.blocks.filter(b => b.type === "checklist").length;
                  const tipsCount = section.blocks.filter(b => b.type === "tips").length;
                  const warningCount = section.blocks.filter(b => b.type === "warning").length;
                  const dialogueCount = section.blocks.filter(b => b.type === "dialogue").length;

                  return (
                    <button
                      key={sIdx}
                      onClick={() => setSelectedSection(sIdx)}
                      className="w-full flex items-center gap-4 px-5 py-4 max-md:px-4 max-md:py-3.5 rounded-xl bg-white border border-black/[0.04] hover:border-rose-500/20 hover:shadow-sm transition-all text-left group"
                    >
                      <div className={`w-10 h-10 max-md:w-9 max-md:h-9 rounded-xl bg-gradient-to-br ${part.color} flex items-center justify-center flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity`}>
                        {section.emoji ? (
                          <span className="text-[18px] max-md:text-[16px]">{section.emoji}</span>
                        ) : (
                          <PartIcon className="w-5 h-5 max-md:w-4 max-md:h-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] max-md:text-[13px] font-medium text-noir-800 group-hover:text-rose-500 transition-colors">
                          {section.title || `섹션 ${sIdx + 1}`}
                        </p>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {checklistCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                              <CheckCircle2 className="w-3 h-3" />체크리스트
                            </span>
                          )}
                          {tipsCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                              <Lightbulb className="w-3 h-3" />꿀팁
                            </span>
                          )}
                          {warningCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                              <AlertTriangle className="w-3 h-3" />주의사항
                            </span>
                          )}
                          {dialogueCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">
                              <MessageSquareQuote className="w-3 h-3" />대사
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-taupe-300 group-hover:text-rose-400 flex-shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* 섹션 콘텐츠 표시 */
            <div className="mt-6 animate-fade-in">
              {/* 섹션 뒤로가기 + 섹션 탭 */}
              {hasSectionNav && selectedSection !== null && (
                <div className="mb-6">
                  <button
                    onClick={() => setSelectedSection(null)}
                    className="inline-flex items-center gap-1.5 text-[13px] text-taupe-500 hover:text-rose-500 transition-colors mb-4"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    전체 항목으로
                  </button>
                  {/* 섹션 탭 pills */}
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                    {parsedSections.map((sec, sIdx) => (
                      <button
                        key={sIdx}
                        onClick={() => setSelectedSection(sIdx)}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                          selectedSection === sIdx
                            ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                            : "bg-white text-taupe-500 border border-black/[0.04] hover:border-rose-500/10"
                        }`}
                      >
                        {sec.emoji && <span className="text-[14px]">{sec.emoji}</span>}
                        {sec.title || `섹션 ${sIdx + 1}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 선택된 섹션 또는 전체 섹션 렌더 */}
              {(hasSectionNav && selectedSection !== null
                ? [{ section: parsedSections[selectedSection], sIdx: selectedSection }]
                : parsedSections.map((section, sIdx) => ({ section, sIdx }))
              ).map(({ section, sIdx }) => (
                <div key={sIdx} className="mb-8 last:mb-0">
                  {section.title && (
                    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-black/[0.04]">
                      {section.emoji && <span className="text-[18px]">{section.emoji}</span>}
                      <h2 className="font-serif-kr text-[18px] max-md:text-[16px] font-light text-noir-800">
                        {section.title}
                      </h2>
                    </div>
                  )}
                  <div className="space-y-4">
                    {section.blocks.map((block, bIdx) => (
                      <div key={bIdx} className="relative">
                        <BlockRenderer
                          block={block}
                          blockId={`${sIdx}_${bIdx}`}
                          checkedItems={checkedItems}
                          onToggleCheck={handleToggleCheck}
                          onOpenSchedule={handleOpenSchedule}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 이전/다음 네비게이션 */}
          <div className="flex justify-between items-center mt-12 pt-6 border-t border-black/[0.04]">
            {selectedPart > 0 ? (
              <button
                onClick={() => setSelectedPart(selectedPart - 1)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-white border border-black/[0.04] transition-colors group"
              >
                <ArrowLeft className="w-4 h-4 text-taupe-400 group-hover:text-rose-500 transition-colors" />
                <div className="text-left">
                  <p className="text-[11px] text-taupe-400">이전</p>
                  <p className="text-[13px] font-medium text-noir-800 group-hover:text-rose-500 transition-colors">
                    {ETIQUETTE_PARTS[selectedPart - 1].title}
                  </p>
                </div>
              </button>
            ) : (
              <div />
            )}
            {selectedPart < ETIQUETTE_PARTS.length - 1 ? (
              <button
                onClick={() => setSelectedPart(selectedPart + 1)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-white border border-black/[0.04] transition-colors group"
              >
                <div className="text-right">
                  <p className="text-[11px] text-taupe-400">다음</p>
                  <p className="text-[13px] font-medium text-noir-800 group-hover:text-rose-500 transition-colors">
                    {ETIQUETTE_PARTS[selectedPart + 1].title}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-taupe-400 group-hover:text-rose-500 transition-colors" />
              </button>
            ) : (
              <div />
            )}
          </div>

          {/* 하단 여백 */}
          <div className="h-12" />
        </div>
      </div>

      {/* 일정 추가 팝오버 (오버레이) */}
      {schedulePopover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setSchedulePopover(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SchedulePopover
              itemText={schedulePopover.text}
              onClose={() => setSchedulePopover(null)}
              onSave={handleSaveSchedule}
            />
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-noir-800 text-white shadow-lg">
            <Check className="w-4 h-4 text-emerald-400" />
            <p className="text-[13px] font-medium">{toast}</p>
          </div>
        </div>
      )}
    </div>
  );
}
