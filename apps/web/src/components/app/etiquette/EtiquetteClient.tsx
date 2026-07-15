"use client";

import { useState, useMemo, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Heart, Users, Gem, Mail, Landmark, Plane, Crown, Home,
  Banknote, CalendarDays, DoorOpen, Camera, UserCheck, Mic,
  Gift, MessageCircle, FileText, Handshake, Building,
  Smartphone, Clock, Sparkles, TreePine, HeartHandshake,
  PiggyBank, ChevronRight, Search, BookOpen, ArrowLeft,
  CheckCircle2, Lightbulb, AlertTriangle, MessageSquareQuote,
  ListOrdered, CalendarPlus, StickyNote, X, Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ETIQUETTE_CATEGORIES,
  ETIQUETTE_GUIDE_NOTICE,
  ETIQUETTE_OFFICIAL_SOURCES,
  ETIQUETTE_PARTS,
} from "@/constants/etiquetteData";
import { useAuthStore } from "@/stores/authStore";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";
import { addEvent, getEvents, updateEvent } from "@/utils/scheduleEvents";
import type { ScheduleEvent } from "@/types/database.types";
import {
  etiquetteChecksStorageKey,
  etiquetteMemosStorageKey,
  readEtiquetteDeviceSnapshot,
} from "@/lib/userScopedBrowserStorage";
import { persistEtiquetteSchedule } from "./etiquetteScheduleSave";
import {
  mutateScheduleEvent,
  ScheduleEventConflictError,
} from "@/lib/schedule/scheduleEventClient";

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
      parts.push(<span key={match.index} className="text-[#795252] font-medium">{match[4]}</span>);
    } else if (match[5]) {
      parts.push(<span key={match.index} className="text-[#795252] font-medium">{match[6]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < str.length) {
    parts.push(str.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

// 블록 렌더러
function BlockRenderer({ block, blockId, checkedItems, itemMemos, deviceStorageAvailable, canSaveToSharedSchedule, onToggleCheck, onOpenSchedule, onOpenMemo }: {
  block: ParsedBlock;
  blockId: string;
  checkedItems: Set<string>;
  itemMemos: Record<string, string>;
  deviceStorageAvailable: boolean;
  canSaveToSharedSchedule: boolean;
  onToggleCheck: (itemId: string) => void;
  onOpenSchedule: (itemId: string, text: string) => void;
  onOpenMemo: (itemId: string, text: string) => void;
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
          <Icon className={`w-5 h-5 ${style.iconColor} flex-shrink-0`} />
          <h4 className={`text-base font-medium ${style.titleColor}`}>{title}</h4>
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
              memo={itemMemos[itemId]}
              deviceStorageAvailable={deviceStorageAvailable}
              canSaveToSharedSchedule={canSaveToSharedSchedule}
              onToggleCheck={onToggleCheck}
              onOpenSchedule={onOpenSchedule}
              onOpenMemo={onOpenMemo}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ItemRenderer({ item, blockType, itemId, isChecked, memo, deviceStorageAvailable = true, canSaveToSharedSchedule, onToggleCheck, onOpenSchedule, onOpenMemo }: {
  item: ParsedItem;
  blockType: string;
  itemId: string;
  isChecked: boolean;
  memo?: string;
  deviceStorageAvailable?: boolean;
  canSaveToSharedSchedule: boolean;
  onToggleCheck: (itemId: string) => void;
  onOpenSchedule: (itemId: string, text: string) => void;
  onOpenMemo: (itemId: string, text: string) => void;
}) {
  const canUseActions = blockType === "checklist" || blockType === "steps" || blockType === "paragraph";
  const actionVisibility = memo
    ? "opacity-100"
    : "opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100 sm:group-focus-within/item:opacity-100";

  switch (item.type) {
    case "group-title":
      return (
        <div className="pt-2 pb-1 first:pt-0">
          <p className="text-[14px] font-semibold text-[#071629]">{item.text}</p>
        </div>
      );

    case "list-item":
      if (blockType === "warning") {
        return (
          <div className="flex gap-2 pl-1">
            <span className="text-red-400 mt-0.5 text-sm flex-shrink-0">&#x2716;</span>
            <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
              {formatInlineText(item.text)}
            </p>
          </div>
        );
      }
      return (
        <div
          onClick={() => deviceStorageAvailable && onToggleCheck(itemId)}
          aria-disabled={!deviceStorageAvailable}
          className={`flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-xl transition-colors group/item ${
            deviceStorageAvailable ? "cursor-pointer hover:bg-[#FDFCFA]" : "cursor-not-allowed opacity-70"
          }`}
        >
          <div className="flex-shrink-0 mt-0.5">
            {isChecked ? (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            ) : (
              <div className="w-6 h-6 rounded-full border-2 border-[#B5ADA3] group-hover/item:border-[#795252] transition-colors" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-[14px] font-medium leading-snug ${isChecked ? "text-[#B5ADA3] line-through" : "text-[#071629]"}`}>
              {formatInlineText(item.text)}
            </p>
            {memo && (
              <p className="mt-2 line-clamp-2 break-words rounded-lg bg-[#FDFCFA] px-3 py-2 text-sm leading-relaxed text-[#6F625D] border border-black/[0.04]">
                <span className="font-medium text-[#795252]">메모</span>
                <span className="ml-2">{memo}</span>
              </p>
            )}
          </div>
          {canUseActions && (
            <div className={`flex-shrink-0 flex items-center gap-1 transition-opacity ${actionVisibility}`}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenMemo(itemId, item.text); }}
                disabled={!deviceStorageAvailable}
                className="p-1.5 rounded-lg hover:bg-white transition-colors"
                title={memo ? "이 기기에 저장된 메모 수정" : "이 기기에 메모 추가"}
                aria-label={memo ? "이 기기에 저장된 메모 수정" : "이 기기에 메모 추가"}
              >
                <StickyNote className={`w-4 h-4 transition-colors ${memo ? "text-[#795252]" : "text-taupe-400 hover:text-[#795252]"}`} />
              </button>
              {canSaveToSharedSchedule && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenSchedule(itemId, item.text); }}
                  className="p-1.5 rounded-lg hover:bg-white transition-colors"
                  title="공동 일정에 추가"
                  aria-label="공동 일정에 추가"
                >
                  <CalendarPlus className="w-4 h-4 text-taupe-400 hover:text-[#795252] transition-colors" />
                </button>
              )}
            </div>
          )}
        </div>
      );

    case "numbered": {
      return (
        <div className="pl-1 py-1.5">
          <div className="flex gap-2">
            <span className={`text-sm font-semibold mt-0.5 flex-shrink-0 ${blockType === "tips" ? "text-amber-500" : blockType === "steps" ? "text-violet-500" : "text-[#795252]"}`}>
              {item.subItems ? "•" : "•"}
            </span>
            <div>
              <p className="text-[14px] font-semibold leading-[1.65] text-[#071629]">
                {formatInlineText(item.text)}
              </p>
              {item.subItems && item.subItems.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {item.subItems.map((sub, i) => (
                    <p key={i} className={`text-[13px] font-medium leading-[1.65] ${sub.startsWith("→") ? "pl-2 text-[#7a8290]" : "text-[#5d6879]"}`}>
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
          <p className="text-[14px] font-semibold text-sky-600">{item.text}</p>
        </div>
      );

    case "dialogue-text":
      return (
        <div className="bg-white/60 rounded-lg px-3 py-2.5 ml-0 border-l-2 border-sky-200">
          {item.text.split("\n").map((line, i) => (
            <p key={i} className="text-[13px] font-medium leading-[1.65] text-[#5d6879] italic">
              {formatInlineText(line)}
            </p>
          ))}
        </div>
      );

    case "arrow":
      return (
        <p className="pl-4 text-[13px] font-medium leading-[1.65] text-[#7a8290]">
          → {formatInlineText(item.text)}
        </p>
      );

    case "text":
    default:
      return (
        <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
          {formatInlineText(item.text)}
        </p>
      );
  }
}

export function canSaveEtiquetteToSharedSchedule({
  isAuthenticated,
  hasJourney,
  isDemo,
}: {
  isAuthenticated: boolean;
  hasJourney: boolean;
  isDemo: boolean;
}) {
  return isAuthenticated && hasJourney && !isDemo;
}

export function EtiquetteStorageNotice({ canSaveToSharedSchedule }: {
  canSaveToSharedSchedule: boolean;
}) {
  return (
    <aside
      aria-label="예절 체크와 메모 저장 위치"
      className="mt-3 rounded-xl border border-[#dce5df] bg-[#f6faf7] px-4 py-3 text-[12px] leading-[1.65] text-[#53645f]"
    >
      <p>체크와 메모는 이 기기에만 저장돼요.</p>
      <p className="mt-1">
        {canSaveToSharedSchedule
          ? "‘공동 일정에 추가’한 항목만 커플 공동 일정에 저장돼요."
          : "공동 일정 저장은 커플 준비 공간이 확인된 계정에서만 사용할 수 있어요."}
      </p>
    </aside>
  );
}

// 일정 추가 팝오버
function SchedulePopover({ itemText, initialDate = "", initialMemo, isExisting = false, onClose, onSave }: {
  itemText: string;
  initialDate?: string;
  initialMemo?: string;
  isExisting?: boolean;
  onClose: () => void;
  onSave: (date: string, memo: string) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [memo, setMemo] = useState(initialMemo ?? itemText);
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
    <div ref={popoverRef} className="w-[520px] max-w-[calc(100vw-32px)] rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_18px_60px_rgba(13,13,15,0.16)] animate-fade-in sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-semibold text-noir-800">
            {isExisting ? "공동 일정 수정" : "공동 일정에 추가"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-taupe-500">
            {isExisting ? "커플 공동 일정에 저장된 항목입니다. 날짜와 메모를 수정할 수 있어요." : "예절 체크리스트 항목을 커플 공동 일정에 저장해요."}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-ivory-200" aria-label="닫기">
          <X className="h-4 w-4 text-taupe-400" />
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-black/[0.04] bg-ivory-50 px-3.5 py-3">
        <p className="mb-1 text-xs font-semibold text-[#795252]">체크리스트 항목</p>
        <p className="line-clamp-3 text-sm font-medium leading-relaxed text-[#504444]">{itemText}</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-taupe-500">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-black/[0.06] px-3.5 py-3 text-base text-noir-800 transition-colors focus:outline-none focus:border-[#795252]/30 focus:ring-1 focus:ring-[#795252]/20"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-taupe-500">메모</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모 (선택)"
            rows={7}
            className="min-h-[168px] w-full resize-y rounded-xl border border-black/[0.06] px-3.5 py-3 text-base leading-relaxed text-noir-800 placeholder:text-taupe-400 transition-colors focus:outline-none focus:border-[#795252]/30 focus:ring-1 focus:ring-[#795252]/20"
          />
        </div>
        <button
          onClick={() => {
            if (!date) return;
            onSave(date, memo);
          }}
          disabled={!date}
          className="w-full rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#946a6a] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isExisting ? "공동 일정 수정" : "공동 일정에 추가"}
        </button>
      </div>
    </div>
  );
}

// 항목 메모 팝오버
function MemoPopover({ itemText, initialMemo, onClose, onSave }: {
  itemText: string;
  initialMemo: string;
  onClose: () => void;
  onSave: (memo: string) => void;
}) {
  const [memo, setMemo] = useState(initialMemo);
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
    <div ref={popoverRef} className="w-[340px] max-w-[calc(100vw-32px)] bg-white rounded-xl border border-black/[0.08] shadow-lg p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <p className="text-base font-medium text-noir-800">메모</p>
        <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-ivory-200 transition-colors" aria-label="닫기">
          <X className="w-4 h-4 text-taupe-400" />
        </button>
      </div>
      <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-taupe-500">
        {itemText}
      </p>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={4}
        placeholder="이 항목에서 기억할 내용을 적어두세요."
        className="w-full resize-none rounded-lg border border-black/[0.06] px-3 py-2.5 text-base leading-relaxed text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-[#795252]/30 focus:ring-1 focus:ring-[#795252]/20 transition-colors"
      />
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave("")}
          className="flex-1 py-2.5 rounded-lg border border-black/[0.06] text-base font-medium text-taupe-500 hover:bg-ivory-100 transition-colors"
        >
          지우기
        </button>
        <button
          type="button"
          onClick={() => onSave(memo)}
          className="flex-[1.4] py-2.5 rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium hover:bg-[#946a6a] transition-colors"
        >
          저장
        </button>
      </div>
    </div>
  );
}

const FREE_PART_LIMIT = 2;

type SchedulePopoverState = {
  itemId: string;
  text: string;
  eventId?: string;
  initialDate?: string;
  initialMemo?: string;
  isExisting?: boolean;
};

function getEtiquetteScheduleSourceKey(partNumber: number, itemId: string) {
  return `etiquette:${partNumber}:${itemId}`;
}

function getLegacyEtiquetteEventMemo(partNumber: number, partTitle: string) {
  return `예절 가이드 Part ${partNumber}: ${partTitle}`;
}

function getSchedulePopoverMemo(event: ScheduleEvent | undefined, itemText: string, itemMemo?: string) {
  if (!event) return itemMemo?.trim() || itemText;
  if (event.sourceKey) return event.memo || itemMemo?.trim() || itemText;
  return event.title || itemMemo?.trim() || itemText;
}

export default function EtiquetteClient() {
  return (
    <Suspense fallback={null}>
      <EtiquettePageInner />
    </Suspense>
  );
}

function EtiquettePageInner() {
  const { isDemo, user } = useAuthStore();
  // 로그인 유저 또는 데모 → 잠금 해제, 비로그인 방문자(coming_soon) → 잠금
  const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE !== "full" && !isDemo && !user;

  const searchParams = useSearchParams();
  const [selectedPart, setSelectedPart] = useState(() => {
    const partParam = searchParams.get("part");
    if (partParam) {
      const idx = ETIQUETTE_PARTS.findIndex((p) => p.number === parseInt(partParam, 10));
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const [selectedSection, setSelectedSection] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [itemMemos, setItemMemos] = useState<Record<string, string>>({});
  const [loadedDeviceStorageScope, setLoadedDeviceStorageScope] = useState<string | null>(null);
  const [deviceStorageStatus, setDeviceStorageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [deviceStorageReload, setDeviceStorageReload] = useState(0);
  const [schedulePopover, setSchedulePopover] = useState<SchedulePopoverState | null>(null);
  const [memoPopover, setMemoPopover] = useState<{ itemId: string; text: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const { dialogRef: sidebarDialogRef } = useAccessibleDialog({
    isOpen: sidebarOpen,
    onClose: () => setSidebarOpen(false),
    returnFocusRef: sidebarTriggerRef,
  });

  const { journey, updateJourney, updateJourneyLocal } = useAuthStore();
  const canSaveToSharedSchedule = canSaveEtiquetteToSharedSchedule({
    isAuthenticated: Boolean(user),
    hasJourney: Boolean(journey?.progress),
    isDemo,
  });
  const part = ETIQUETTE_PARTS[selectedPart];
  const PartIcon = ICON_MAP[part.icon] || BookOpen;
  const requestedDeviceStorageScope = user ? `${user.id}:${part.number}` : null;
  const hasCurrentDeviceSnapshot =
    requestedDeviceStorageScope !== null && loadedDeviceStorageScope === requestedDeviceStorageScope;
  const visibleCheckedItems = useMemo(
    () => (hasCurrentDeviceSnapshot ? checkedItems : new Set<string>()),
    [checkedItems, hasCurrentDeviceSnapshot],
  );
  const visibleItemMemos = useMemo(
    () => (hasCurrentDeviceSnapshot ? itemMemos : {}),
    [hasCurrentDeviceSnapshot, itemMemos],
  );
  const deviceStorageAvailable =
    !user || (deviceStorageStatus === "ready" && hasCurrentDeviceSnapshot);

  // 체크와 메모를 한 번에 읽는다. 한쪽이라도 실패하면 기존 스냅샷을
  // 보존하고 읽기 전용으로 전환해, 저장된 기록이 빈 상태처럼 보이지 않게 한다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!user) {
        setCheckedItems(new Set());
        setItemMemos({});
        setLoadedDeviceStorageScope(null);
        setDeviceStorageStatus("ready");
        return;
      }
      setDeviceStorageStatus("loading");
      try {
        const snapshot = readEtiquetteDeviceSnapshot(localStorage, user.id, part.number);
        setCheckedItems(new Set(snapshot.checkedItemIds));
        setItemMemos(snapshot.itemMemos);
        setLoadedDeviceStorageScope(`${user.id}:${part.number}`);
        setDeviceStorageStatus("ready");
      } catch {
        setDeviceStorageStatus("error");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [deviceStorageReload, part.number, user]);

  // 체크 상태 토글
  const handleToggleCheck = useCallback((itemId: string) => {
    if (!user) {
      setToast({ message: "로그인한 계정에서만 체크를 저장할 수 있습니다.", tone: "error" });
      return;
    }
    if (!deviceStorageAvailable || !hasCurrentDeviceSnapshot) {
      setToast({ message: "기기 저장 기록을 먼저 다시 불러와 주세요.", tone: "error" });
      return;
    }
    const next = new Set(visibleCheckedItems);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);

    try {
      localStorage.setItem(
        etiquetteChecksStorageKey(user.id, part.number),
        JSON.stringify([...next])
      );
      setCheckedItems(next);
    } catch {
      setToast({ message: "체크 상태를 저장하지 못했습니다. 다시 시도해주세요.", tone: "error" });
    }
  }, [deviceStorageAvailable, hasCurrentDeviceSnapshot, part.number, user, visibleCheckedItems]);

  const findExistingScheduleEvent = useCallback((itemId: string, text: string) => {
    if (!journey?.progress) return undefined;
    const progress = journey.progress as unknown as Record<string, unknown>;
    const events = getEvents(progress);
    const sourceKey = getEtiquetteScheduleSourceKey(part.number, itemId);
    const legacyMemo = getLegacyEtiquetteEventMemo(part.number, part.title);
    const savedMemo = visibleItemMemos[itemId]?.trim();

    return events.find((event) => event.sourceKey === sourceKey)
      ?? events.find((event) =>
        event.categoryKey === "etiquette"
        && event.memo === legacyMemo
        && (event.title === text || (!!savedMemo && event.title === savedMemo))
      );
  }, [journey, part.number, part.title, visibleItemMemos]);

  // 일정 추가 팝오버 열기
  const handleOpenSchedule = useCallback((itemId: string, text: string) => {
    const existingEvent = findExistingScheduleEvent(itemId, text);
    setMemoPopover(null);
    setSchedulePopover({
      itemId,
      text,
      eventId: existingEvent?.id,
      initialDate: existingEvent?.date ?? "",
      initialMemo: getSchedulePopoverMemo(existingEvent, text, visibleItemMemos[itemId]),
      isExisting: Boolean(existingEvent),
    });
  }, [findExistingScheduleEvent, visibleItemMemos]);

  // 메모 팝오버 열기
  const handleOpenMemo = useCallback((itemId: string, text: string) => {
    if (user && (!deviceStorageAvailable || !hasCurrentDeviceSnapshot)) {
      setToast({ message: "기기 저장 기록을 먼저 다시 불러와 주세요.", tone: "error" });
      return;
    }
    setSchedulePopover(null);
    setMemoPopover({ itemId, text });
  }, [deviceStorageAvailable, hasCurrentDeviceSnapshot, user]);

  // 항목 메모 저장
  const handleSaveMemo = useCallback((memo: string) => {
    if (!memoPopover) return;
    if (!user) {
      setToast({ message: "로그인한 계정에서만 메모를 저장할 수 있습니다.", tone: "error" });
      return;
    }
    if (!deviceStorageAvailable || !hasCurrentDeviceSnapshot) {
      setToast({ message: "기기 저장 기록을 먼저 다시 불러와 주세요.", tone: "error" });
      return;
    }
    const trimmed = memo.trim();
    const next = { ...visibleItemMemos };
    if (trimmed) next[memoPopover.itemId] = trimmed;
    else delete next[memoPopover.itemId];

    try {
      localStorage.setItem(
        etiquetteMemosStorageKey(user.id, part.number),
        JSON.stringify(next)
      );
    } catch {
      setToast({ message: "메모를 저장하지 못했습니다. 브라우저 저장 공간을 확인해주세요.", tone: "error" });
      return;
    }
    setItemMemos(next);
    setMemoPopover(null);
    setToast({
      message: trimmed ? "이 기기에 메모를 저장했습니다" : "이 기기에서 메모를 삭제했습니다",
      tone: "success",
    });
  }, [deviceStorageAvailable, hasCurrentDeviceSnapshot, memoPopover, part.number, user, visibleItemMemos]);

  // 일정 저장
  const handleSaveSchedule = useCallback(async (date: string, memo: string) => {
    if (!journey?.progress || !schedulePopover) return;
    const progress = journey.progress as unknown as Record<string, unknown>;
    const sourceKey = getEtiquetteScheduleSourceKey(part.number, schedulePopover.itemId);
    const trimmedMemo = memo.trim();
    const eventTitle = schedulePopover.text || "예절 가이드 항목";
    const eventMemo = trimmedMemo || eventTitle;
    const newProgress = schedulePopover.eventId
      ? updateEvent(progress, schedulePopover.eventId, {
        date,
        title: eventTitle,
        memo: eventMemo,
        categoryKey: "etiquette",
        sourceKey,
      })
      : addEvent(progress, {
        date,
        title: eventTitle,
        memo: eventMemo,
        categoryKey: "etiquette",
        sourceKey,
      }).newProgress;

    const mode = schedulePopover.eventId ? "update" : "add";
    if (isDemo) {
      const result = await persistEtiquetteSchedule({
        nextProgress: newProgress as typeof journey.progress,
        mode,
        updateJourney,
      });
      if (!result.ok) {
        setToast({ message: result.message, tone: "error" });
        return;
      }
      setSchedulePopover(null);
      setToast({ message: result.message, tone: "success" });
      return;
    }

    const previousEvent = schedulePopover.eventId
      ? getEvents(progress).find((event) => event.id === schedulePopover.eventId)
      : undefined;
    const nextEvent = getEvents(newProgress).find((event) =>
      schedulePopover.eventId
        ? event.id === schedulePopover.eventId
        : event.sourceKey === sourceKey
    );
    if (!nextEvent || (schedulePopover.eventId && !previousEvent)) {
      setToast({ message: "공동 일정의 최신 상태를 확인하지 못했습니다.", tone: "error" });
      return;
    }

    try {
      const result = await mutateScheduleEvent(
        previousEvent
          ? {
              operation: "update",
              eventId: previousEvent.id,
              event: nextEvent,
              expectedUpdatedAt: previousEvent.updatedAt,
            }
          : { operation: "add", event: nextEvent },
      );
      updateJourneyLocal({ progress: result.progress as typeof journey.progress });
      setSchedulePopover(null);
      setToast({
        message: mode === "update" ? "공동 일정을 수정했습니다." : "공동 일정에 추가했습니다.",
        tone: "success",
      });
    } catch (error) {
      if (error instanceof ScheduleEventConflictError) {
        updateJourneyLocal({ progress: error.progress as typeof journey.progress });
      }
      setToast({
        message: error instanceof Error
          ? error.message
          : "공동 일정을 저장하지 못했습니다. 입력한 내용은 그대로 두었으니 다시 시도해주세요.",
        tone: "error",
      });
    }
  }, [journey, isDemo, updateJourney, updateJourneyLocal, schedulePopover, part.number]);

  // 토스트 자동 닫기
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 파트 선택 시 콘텐츠 스크롤 맨 위로 + 섹션 초기화
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    const timer = window.setTimeout(() => {
      setSelectedSection(null);
      setSchedulePopover(null);
      setMemoPopover(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedPart]);

  // 섹션 선택 시 스크롤 맨 위로
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    const timer = window.setTimeout(() => {
      setSchedulePopover(null);
      setMemoPopover(null);
    }, 0);
    return () => window.clearTimeout(timer);
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
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-white border border-black/[0.06] text-base text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-[#795252]/30 focus:ring-1 focus:ring-[#795252]/20 transition-colors"
            />
          </div>
        </div>

        {/* 파트 목록 */}
        <div className="flex-1 overflow-y-auto py-2">
          {searchQuery ? (
            // 검색 결과
            <div className="px-2">
              {filteredParts.length === 0 && (
                <p className="text-base text-taupe-400 text-center py-8">검색 결과가 없습니다</p>
              )}
              {filteredParts.map((p) => {
                const Icon = ICON_MAP[p.icon] || BookOpen;
                const isActive = ETIQUETTE_PARTS[selectedPart].number === p.number;
                const isLocked = isComingSoon && p.number > FREE_PART_LIMIT;
                return (
                  <button
                    key={p.number}
                    onClick={() => !isLocked && selectPart(p.number)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-0.5 ${
                      isLocked ? "opacity-40 cursor-not-allowed" : isActive ? "bg-[#795252]/10 text-[#795252]" : "hover:bg-white text-noir-800"
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-base font-medium truncate ${isActive ? "text-[#795252]" : ""}`}>
                        {p.title}
                      </p>
                      <p className="text-sm text-taupe-400 truncate">{p.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            // 카테고리별 목록
            ETIQUETTE_CATEGORIES.map((cat) => (
              <div key={cat.label} className="mb-2">
                <p className="px-4 py-1.5 text-sm font-semibold text-taupe-400 uppercase tracking-wider">
                  {cat.label}
                </p>
                <div className="px-2">
                  {cat.parts.map((num) => {
                    const p = ETIQUETTE_PARTS.find((ep) => ep.number === num);
                    if (!p) return null;
                    const Icon = ICON_MAP[p.icon] || BookOpen;
                    const isActive = ETIQUETTE_PARTS[selectedPart].number === p.number;
                    const isLocked = isComingSoon && p.number > FREE_PART_LIMIT;
                    return (
                      <button
                        key={p.number}
                        onClick={() => !isLocked && selectPart(p.number)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors mb-0.5 ${
                          isLocked ? "opacity-40 cursor-not-allowed" : isActive ? "bg-[#795252]/10 text-[#795252]" : "hover:bg-white text-noir-800"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                          <Icon className="w-4 h-4 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className={`text-base font-medium truncate ${isActive ? "text-[#795252]" : ""}`}>
                            {p.title}
                          </p>
                        </div>
                        {isLocked && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto flex-shrink-0 text-taupe-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>}
                        {!isLocked && isActive && <ChevronRight className="w-4 h-4 text-[#946a6a] ml-auto flex-shrink-0" />}
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
        <div
          ref={sidebarDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="전체 예절 목록"
          tabIndex={-1}
          className="lg:hidden fixed inset-0 z-50 flex"
        >
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-[300px] bg-ivory-50 flex flex-col h-full animate-fade-in">
            <div className="p-4 border-b border-black/[0.04] flex items-center justify-between">
              <p className="text-lg font-medium text-noir-800">전체 목록</p>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="전체 예절 목록 닫기"
                data-dialog-initial-focus
                className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white"
              >
                <ArrowLeft className="w-6 h-6 text-taupe-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {ETIQUETTE_CATEGORIES.map((cat) => (
                <div key={cat.label} className="mb-2">
                  <p className="px-4 py-1.5 text-sm font-semibold text-taupe-400 uppercase tracking-wider">
                    {cat.label}
                  </p>
                  <div className="px-2">
                    {cat.parts.map((num) => {
                      const p = ETIQUETTE_PARTS.find((ep) => ep.number === num);
                      if (!p) return null;
                      const Icon = ICON_MAP[p.icon] || BookOpen;
                      const isActive = ETIQUETTE_PARTS[selectedPart].number === p.number;
                      const isLocked = isComingSoon && p.number > FREE_PART_LIMIT;
                      return (
                        <button
                          key={p.number}
                          onClick={() => !isLocked && selectPart(p.number)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors mb-0.5 ${
                            isLocked ? "opacity-40 cursor-not-allowed" : isActive ? "bg-[#795252]/10 text-[#795252]" : "hover:bg-white text-noir-800"
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${p.color} flex items-center justify-center flex-shrink-0`}>
                            <Icon className="w-3.5 h-3.5 text-white" />
                          </div>
                          <p className={`text-base font-medium truncate ${isActive ? "text-[#795252]" : ""}`}>
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
              ref={sidebarTriggerRef}
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="전체 예절 목록 열기"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-black/[0.06] hover:bg-white"
            >
              <BookOpen className="w-4 h-4 text-taupe-500" />
            </button>
            <div
              ref={pillsRef}
              className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1"
            >
              {ETIQUETTE_PARTS.map((p, idx) => {
                const isActive = selectedPart === idx;
                const isLocked = isComingSoon && p.number > FREE_PART_LIMIT;
                return (
                  <button
                    key={p.number}
                    onClick={() => !isLocked && setSelectedPart(idx)}
                    className={`flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium transition-colors ${
                      isLocked
                        ? "bg-white/60 text-taupe-400/50 border border-black/[0.03] cursor-not-allowed"
                        : isActive
                          ? "bg-gradient-to-br from-[#795252] to-[#946a6a] text-white"
                          : "bg-white text-taupe-500 border border-black/[0.06]"
                    }`}
                  >
                    {isLocked ? "🔒 " : ""}{p.title.replace(/ 예절| 에티켓| 총정리| & 법적 절차/g, "")}
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
              <div className={`w-14 h-14 max-md:w-12 max-md:h-12 rounded-xl bg-gradient-to-br ${part.color} flex items-center justify-center`}>
                <PartIcon className="w-7 h-7 max-md:w-6 max-md:h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-taupe-400 bg-taupe-400/10 px-2.5 py-0.5 rounded-full">
                    Part {part.number}
                  </span>
                </div>
                <h1 className="font-serif-kr text-[26px] font-medium leading-tight text-[#071629] max-md:text-[24px] sm:text-[30px]">
                  {part.title}
                </h1>
              </div>
            </div>
            <p className="mb-1 text-[14px] font-semibold text-[#5d6879] max-md:text-[13px]">
              {part.subtitle}
            </p>
            <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
              {part.description}
            </p>
            <aside
              aria-label="예절 가이드 이용 전 확인"
              className="mt-4 rounded-xl border border-[#e5d7bc] bg-[#fffaf0] px-4 py-3 text-[12px] leading-[1.65] text-[#5d6879]"
            >
              <p className="font-semibold text-[#504444]">먼저 확인해 주세요</p>
              <p className="mt-1">{ETIQUETTE_GUIDE_NOTICE}</p>
              <p className="mt-1">
                주민등록번호·신분증 사진은 메모·채팅·공개 링크에 입력하지 마세요.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {ETIQUETTE_OFFICIAL_SOURCES.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#795252] underline decoration-[#795252]/30 underline-offset-2 hover:decoration-[#795252]"
                  >
                    {source.label}
                  </a>
                ))}
              </div>
            </aside>
            <EtiquetteStorageNotice canSaveToSharedSchedule={canSaveToSharedSchedule} />
            {user && deviceStorageStatus === "loading" && (
              <p
                role="status"
                className="mt-3 rounded-xl border border-[#dce5df] bg-white px-4 py-3 text-[12px] text-[#53645f]"
              >
                이 기기의 체크와 메모를 불러오고 있어요. 확인이 끝날 때까지 변경하지 않습니다.
              </p>
            )}
            {user && deviceStorageStatus === "error" && (
              <aside
                role="alert"
                className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] leading-[1.65] text-red-800"
              >
                <p className="font-semibold">기기 저장 기록을 불러오지 못했습니다.</p>
                <p className="mt-1">
                  {hasCurrentDeviceSnapshot
                    ? "마지막으로 불러온 기록을 그대로 보여주며, 다시 확인될 때까지 변경하지 않습니다."
                    : "불러오기 실패가 빈 기록을 뜻하지 않아 체크와 메모 변경을 잠갔습니다."}
                </p>
                <button
                  type="button"
                  onClick={() => setDeviceStorageReload((value) => value + 1)}
                  className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-800"
                >
                  다시 불러오기
                </button>
              </aside>
            )}
          </div>

          {/* 섹션 네비게이션 or 콘텐츠 */}
          {hasSectionNav && selectedSection === null ? (
            /* 섹션 선택 카드 */
            <div className="mt-8 animate-fade-in">
                <p className="mb-4 text-[13px] font-medium text-[#5d6879]">
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
                      className="w-full flex items-center gap-4 px-5 py-4 max-md:px-4 max-md:py-3.5 rounded-xl bg-white border border-black/[0.04] hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] transition-all text-left group"
                    >
                      <div className={`w-10 h-10 max-md:w-9 max-md:h-9 rounded-xl bg-gradient-to-br ${part.color} flex items-center justify-center flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity`}>
                        {section.emoji ? (
                          <span className="text-[18px] max-md:text-[16px]">{section.emoji}</span>
                        ) : (
                          <PartIcon className="w-5 h-5 max-md:w-4 max-md:h-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-[#071629] transition-colors group-hover:text-[#36534E] max-md:text-[13px]">
                          {section.title || `섹션 ${sIdx + 1}`}
                        </p>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {checklistCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-sm text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                              <CheckCircle2 className="w-3.5 h-3.5" />체크리스트
                            </span>
                          )}
                          {tipsCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-sm text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                              <Lightbulb className="w-3.5 h-3.5" />꿀팁
                            </span>
                          )}
                          {warningCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-sm text-red-500 bg-red-50 px-2 py-0.5 rounded">
                              <AlertTriangle className="w-3.5 h-3.5" />주의사항
                            </span>
                          )}
                          {dialogueCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-sm text-sky-600 bg-sky-50 px-2 py-0.5 rounded">
                              <MessageSquareQuote className="w-3.5 h-3.5" />대사
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-taupe-300 group-hover:text-[#946a6a] flex-shrink-0 transition-colors" />
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
                    className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5d6879] transition-colors hover:text-[#36534E]"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    전체 항목으로
                  </button>
                  {/* 섹션 탭 pills */}
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                    {parsedSections.map((sec, sIdx) => (
                      <button
                        key={sIdx}
                        onClick={() => setSelectedSection(sIdx)}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${
                          selectedSection === sIdx
                            ? "bg-[#795252]/10 text-[#795252] border border-[#795252]/20"
                            : "bg-white text-[#504444] hover:text-[#795252]"
                        }`}
                      >
                        {sec.emoji && <span className="text-[13px]">{sec.emoji}</span>}
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
                      <h2 className="font-serif-kr text-[22px] font-medium leading-tight text-[#071629] max-md:text-[20px]">
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
                          checkedItems={visibleCheckedItems}
                          itemMemos={visibleItemMemos}
                          deviceStorageAvailable={deviceStorageAvailable}
                          canSaveToSharedSchedule={canSaveToSharedSchedule}
                          onToggleCheck={handleToggleCheck}
                          onOpenSchedule={handleOpenSchedule}
                          onOpenMemo={handleOpenMemo}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 이전/다음 네비게이션 (섹션 → 파트 순서) */}
          <div className="flex justify-between items-center mt-12 pt-6 border-t border-black/[0.04]">
            {(() => {
              // 이전 버튼 로직
              let prevLabel = "";
              let prevSub = "";
              let onPrev: (() => void) | null = null;

              if (hasSectionNav && selectedSection !== null && selectedSection > 0) {
                // 같은 파트 내 이전 섹션
                prevLabel = parsedSections[selectedSection - 1].title || `섹션 ${selectedSection}`;
                prevSub = part.title;
                onPrev = () => setSelectedSection(selectedSection - 1);
              } else if (hasSectionNav && selectedSection === 0) {
                // 첫 섹션 → 섹션 목록으로
                prevLabel = "전체 항목";
                prevSub = part.title;
                onPrev = () => setSelectedSection(null);
              } else if (selectedPart > 0) {
                // 이전 파트 (잠금 체크)
                const prevPartNumber = ETIQUETTE_PARTS[selectedPart - 1].number;
                const prevLocked = isComingSoon && prevPartNumber > FREE_PART_LIMIT;
                if (!prevLocked) {
                  prevLabel = ETIQUETTE_PARTS[selectedPart - 1].title;
                  onPrev = () => setSelectedPart(selectedPart - 1);
                }
              }

              return onPrev ? (
                <button
                  onClick={onPrev}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-white border border-black/[0.04] transition-colors group max-w-[45%]"
                >
                  <ArrowLeft className="w-4 h-4 text-taupe-400 group-hover:text-[#795252] transition-colors flex-shrink-0" />
                  <div className="text-left min-w-0">
                    <p className="text-sm text-taupe-400">이전</p>
                    <p className="text-base font-medium text-noir-800 group-hover:text-[#795252] transition-colors truncate">
                      {prevLabel}
                    </p>
                    {prevSub && <p className="text-sm text-taupe-400 truncate">{prevSub}</p>}
                  </div>
                </button>
              ) : <div />;
            })()}
            {(() => {
              // 다음 버튼 로직
              let nextLabel = "";
              let nextSub = "";
              let onNext: (() => void) | null = null;

              if (hasSectionNav && selectedSection !== null && selectedSection < parsedSections.length - 1) {
                // 같은 파트 내 다음 섹션
                nextLabel = parsedSections[selectedSection + 1].title || `섹션 ${selectedSection + 2}`;
                nextSub = part.title;
                onNext = () => setSelectedSection(selectedSection + 1);
              } else if (hasSectionNav && selectedSection !== null && selectedSection === parsedSections.length - 1 && selectedPart < ETIQUETTE_PARTS.length - 1) {
                // 마지막 섹션 → 다음 파트 (잠금 체크)
                const nextPartNumber = ETIQUETTE_PARTS[selectedPart + 1].number;
                const nextLocked = isComingSoon && nextPartNumber > FREE_PART_LIMIT;
                if (!nextLocked) {
                  nextLabel = ETIQUETTE_PARTS[selectedPart + 1].title;
                  onNext = () => setSelectedPart(selectedPart + 1);
                }
              } else if (hasSectionNav && selectedSection === null && selectedPart < ETIQUETTE_PARTS.length - 1) {
                // 섹션 목록 화면 → 다음 파트 (잠금 체크)
                const nextPartNumber = ETIQUETTE_PARTS[selectedPart + 1].number;
                const nextLocked = isComingSoon && nextPartNumber > FREE_PART_LIMIT;
                if (!nextLocked) {
                  nextLabel = ETIQUETTE_PARTS[selectedPart + 1].title;
                  onNext = () => setSelectedPart(selectedPart + 1);
                }
              } else if (!hasSectionNav && selectedPart < ETIQUETTE_PARTS.length - 1) {
                // 섹션 없는 파트 → 다음 파트 (잠금 체크)
                const nextPartNumber = ETIQUETTE_PARTS[selectedPart + 1].number;
                const nextLocked = isComingSoon && nextPartNumber > FREE_PART_LIMIT;
                if (!nextLocked) {
                  nextLabel = ETIQUETTE_PARTS[selectedPart + 1].title;
                  onNext = () => setSelectedPart(selectedPart + 1);
                }
              }

              return onNext ? (
                <button
                  onClick={onNext}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl hover:bg-white border border-black/[0.04] transition-colors group max-w-[45%]"
                >
                  <div className="text-right min-w-0">
                    <p className="text-sm text-taupe-400">다음</p>
                    <p className="text-base font-medium text-noir-800 group-hover:text-[#795252] transition-colors truncate">
                      {nextLabel}
                    </p>
                    {nextSub && <p className="text-sm text-taupe-400 truncate">{nextSub}</p>}
                  </div>
                  <ChevronRight className="w-4 h-4 text-taupe-400 group-hover:text-[#795252] transition-colors flex-shrink-0" />
                </button>
              ) : <div />;
            })()}
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
              initialDate={schedulePopover.initialDate}
              initialMemo={schedulePopover.initialMemo}
              isExisting={schedulePopover.isExisting}
              onClose={() => setSchedulePopover(null)}
              onSave={handleSaveSchedule}
            />
          </div>
        </div>
      )}

      {/* 메모 팝오버 (오버레이) */}
      {memoPopover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setMemoPopover(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <MemoPopover
              itemText={memoPopover.text}
              initialMemo={visibleItemMemos[memoPopover.itemId] || ""}
              onClose={() => setMemoPopover(null)}
              onSave={handleSaveMemo}
            />
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div
            role={toast.tone === "error" ? "alert" : "status"}
            className={`flex items-center gap-2 rounded-xl border px-4 py-3 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.08)] ${
              toast.tone === "error" ? "border-red-200" : "border-black/[0.04]"
            }`}
          >
            {toast.tone === "error" ? (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            ) : (
              <Check className="w-5 h-5 text-[#795252]" />
            )}
            <p className="text-base font-medium text-[#1A1A1F]">{toast.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
