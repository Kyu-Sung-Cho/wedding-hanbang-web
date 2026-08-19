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
import { ETIQUETTE_PARTS, ETIQUETTE_CATEGORIES } from "@/constants/etiquetteData";
import { useAuthStore } from "@/stores/authStore";
import { addEvent, getEvents, updateEvent } from "@/utils/scheduleEvents";
import type { ScheduleEvent } from "@/types/database.types";

// 아이콘 맵
const ICON_MAP: Record<string, LucideIcon> = {
  Heart, Users, Gem, Mail, Church: Landmark, Plane, Crown, Home,
  Banknote, Calendar: CalendarDays, DoorOpen, Camera, UserCheck, Mic,
  Gift, MessageCircle, FileText, Handshake, Building,
  Smartphone, Clock, Sparkles, TreePine, HeartHandshake, PiggyBank,
  BookOpen, Landmark,
};

// 마크다운 콘텐츠 파서
export interface ParsedSection {
  title: string;
  emoji?: string;
  blocks: ParsedBlock[];
}

export interface ParsedBlock {
  /**
   * `reference`는 2026-08-19에 추가했다. 그 전에는 제목에 "가이드·분담·기준" 같은 낱말이
   * 들어가면 무조건 `checklist`가 됐고, 그래서 축의금 금액표와 혼수 분담표가 **체크박스
   * 달린 할 일**로 렌더됐다 — 참고 수치가 실행 지시로 승격되는 사고다. 읽으라고 쓴 표는
   * 이 타입으로 보내고, 체크·일정 추가 같은 실행 동작을 붙이지 않는다.
   */
  type: "checklist" | "tips" | "warning" | "dialogue" | "steps" | "paragraph" | "heading" | "reference";
  title?: string;
  items: ParsedItem[];
}

export interface ParsedItem {
  type:
    | "group-title"
    | "list-item"
    | "numbered"
    | "text"
    | "dialogue-speaker"
    | "dialogue-text"
    | "arrow"
    /** 마크다운 표 한 줄. 파서가 `|`를 몰라서 파이프 문자가 그대로 노출되던 것을 고쳤다. */
    | "table-row";
  text: string;
  subItems?: string[];
  /** table-row 전용. 셀 배열과 헤더 여부. */
  cells?: string[];
  isHeader?: boolean;
}

export function parseContent(content: string): ParsedSection[] {
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
      // 예전에는 여기서 `checklist`를 줬다. 그 결과 "관계별 축의금 금액 가이드", "전통적
      // 분담 기준", "여성/남성 하객 복장 가이드" 같은 **참고 표 8개**가 체크박스 할 일이
      // 됐다. 읽을 것과 할 것을 구분한다.
      type = "reference";
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

    // 마크다운 표: | 셀 | 셀 |
    // 파서에 이 분기가 없어서 Part 25 비용 참고표 11줄이 파이프 문자 그대로 노출됐다.
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
      // |---|---| 구분선은 표시하지 않고, 바로 앞 줄을 헤더로 승격시킨다.
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) {
        const previous = items[items.length - 1];
        if (previous?.type === "table-row") previous.isHeader = true;
        continue;
      }
      items.push({ type: "table-row", text: trimmed, cells });
      continue;
    }

    // 화자 표기(**혼주에게 인사:**)가 먼저다. 아래 group-title 분기도 `**`로 시작해
    // `**`로 끝나는 줄을 잡기 때문에, 순서가 반대였을 때 dialogue-speaker 분기는 한 번도
    // 실행되지 않는 죽은 코드였다. 그래서 대사 줄들이 본문 텍스트로 흘러내렸고,
    // "(X) → 이건 혼주가 하는 말" 같은 편집용 주석까지 그대로 화면에 나갔다.
    if (trimmed.startsWith("**") && trimmed.includes(":**")) {
      const speaker = trimmed.replace(/\*\*/g, "").replace(/:$/, "");
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
      // 원문에 `- ✅ …` 형식이 74줄 있다. 렌더러가 이미 동그란 체크 표시를 그리므로
      // 앞머리 체크 글자를 그대로 두면 한 줄에 체크가 두 개 찍힌다.
      const text = trimmed.substring(2).replace(/^[✅☑✔✓]️?\s*/, "");
      items.push({ type: "list-item", text });
      continue;
    }

    // Arrow line (sub-tip)
    if (trimmed.startsWith("→ ")) {
      items.push({ type: "arrow", text: trimmed.substring(2) });
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
export function BlockRenderer({ block, blockId, checkedItems, itemMemos, onToggleCheck, onOpenSchedule, onOpenMemo }: {
  block: ParsedBlock;
  blockId: string;
  checkedItems: Set<string>;
  itemMemos: Record<string, string>;
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
    reference: { bg: "bg-[#FDFCFA]", border: "border-black/[0.06]", icon: BookOpen, iconColor: "text-taupe-400", titleColor: "text-noir-800" },
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
      {type === "reference" && (
        <p className="mb-3 text-[12px] font-medium leading-[1.6] text-[#7a8290]">
          읽고 참고하는 표예요. 정해진 기준이 아니라 흔히 그렇게 한다는 뜻이고, 금액·분담은
          두 분과 양가가 정하시면 됩니다.
        </p>
      )}
      <div className="space-y-1.5">
        {groupTableRows(items).map((item, idx) => {
          if (Array.isArray(item)) {
            return <TableRenderer key={`table_${idx}`} rows={item} />;
          }
          const itemId = `${blockId}_${idx}`;
          return (
            <ItemRenderer
              key={idx}
              item={item}
              blockType={type}
              itemId={itemId}
              isChecked={checkedItems.has(itemId)}
              memo={itemMemos[itemId]}
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

/** 연속한 표 행을 한 덩어리로 묶는다. 나머지 항목은 그대로 통과시킨다. */
function groupTableRows(items: ParsedItem[]): (ParsedItem | ParsedItem[])[] {
  const grouped: (ParsedItem | ParsedItem[])[] = [];
  let run: ParsedItem[] = [];
  const flush = () => {
    if (run.length > 0) {
      grouped.push(run);
      run = [];
    }
  };
  for (const item of items) {
    if (item.type === "table-row") {
      run.push(item);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();
  return grouped;
}

function TableRenderer({ rows }: { rows: ParsedItem[] }) {
  const [head, ...rest] = rows;
  const body = head?.isHeader ? rest : rows;
  return (
    <div className="my-2 overflow-x-auto rounded-lg border border-black/[0.06]">
      <table className="w-full border-collapse text-left">
        {head?.isHeader && (
          <thead>
            <tr className="bg-[#F6F3EF]">
              {(head.cells ?? []).map((cell, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 text-[12.5px] font-semibold text-[#071629]">
                  {formatInlineText(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-t border-black/[0.05]">
              {(row.cells ?? []).map((cell, c) => (
                <td key={c} className="px-3 py-2 align-top text-[13px] font-medium leading-[1.6] text-[#5d6879]">
                  {formatInlineText(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 대사 줄에 붙은 편집용 정오 표기를 화면 언어로 바꾼다.
 * 원문 예: `와주셔서 감사합니다 (X) → 이건 혼주가 하는 말` / `귀한 자리에 … (O)`
 * 그대로 두면 사용자가 그대로 읽어버린다.
 */
function parseDialogueLine(line: string): { text: string; verdict: "ok" | "avoid" | null; note?: string } {
  const marked = line.match(/^(.*?)\s*\((X|O|x|o)\)\s*(?:→\s*(.*))?$/);
  if (!marked) return { text: line, verdict: null };
  const verdict = /x/i.test(marked[2]) ? "avoid" : "ok";
  return { text: marked[1].trim(), verdict, note: marked[3]?.trim() || undefined };
}

function ItemRenderer({ item, blockType, itemId, isChecked, memo, onToggleCheck, onOpenSchedule, onOpenMemo }: {
  item: ParsedItem;
  blockType: string;
  itemId: string;
  isChecked: boolean;
  memo?: string;
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
      // 참고 표는 읽는 것이지 완료하는 것이 아니다. 체크·메모·일정 버튼을 붙이지 않는다.
      if (blockType === "reference") {
        return (
          <div className="flex gap-2 pl-1">
            <span aria-hidden className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-[#B5ADA3]" />
            <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
              {formatInlineText(item.text)}
            </p>
          </div>
        );
      }
      return (
        <div
          onClick={() => onToggleCheck(itemId)}
          className="flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-xl cursor-pointer hover:bg-[#FDFCFA] transition-colors group/item"
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
                className="p-1.5 rounded-lg hover:bg-white transition-colors"
                title={memo ? "메모 수정" : "메모 추가"}
                aria-label={memo ? "메모 수정" : "메모 추가"}
              >
                <StickyNote className={`w-4 h-4 transition-colors ${memo ? "text-[#795252]" : "text-taupe-400 hover:text-[#795252]"}`} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenSchedule(itemId, item.text); }}
                className="p-1.5 rounded-lg hover:bg-white transition-colors"
                title="일정에 추가"
                aria-label="일정에 추가"
              >
                <CalendarPlus className="w-4 h-4 text-taupe-400 hover:text-[#795252] transition-colors" />
              </button>
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
          {item.text.split("\n").map((line, i) => {
            const { text, verdict, note } = parseDialogueLine(line);
            if (!verdict) {
              return (
                <p key={i} className="text-[13px] font-medium leading-[1.65] text-[#5d6879] italic">
                  {formatInlineText(line)}
                </p>
              );
            }
            return (
              <div key={i} className="flex gap-2 py-0.5">
                <span
                  aria-hidden
                  className={`mt-0.5 flex-shrink-0 text-[12px] font-semibold ${verdict === "avoid" ? "text-red-400" : "text-emerald-500"}`}
                >
                  {verdict === "avoid" ? "✖" : "✓"}
                </span>
                <p className="text-[13px] font-medium leading-[1.65]">
                  <span className={verdict === "avoid" ? "text-[#9aa2ad] line-through italic" : "text-[#5d6879] italic"}>
                    {formatInlineText(text)}
                  </span>
                  <span className="sr-only">{verdict === "avoid" ? " (피할 표현)" : " (권하는 표현)"}</span>
                  {note && <span className="ml-2 not-italic text-[12px] text-[#7a8290]">— {note}</span>}
                </p>
              </div>
            );
          })}
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
            {isExisting ? "일정 수정" : "일정에 추가"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-taupe-500">
            {isExisting ? "이미 추가된 일정입니다. 날짜와 메모를 수정할 수 있어요." : "예절 체크리스트 항목을 일정으로 옮겨둘게요."}
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
          {isExisting ? "일정 수정" : "일정에 추가"}
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
  const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon" && !isDemo && !user;

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
  const [schedulePopover, setSchedulePopover] = useState<SchedulePopoverState | null>(null);
  const [memoPopover, setMemoPopover] = useState<{ itemId: string; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);

  const { journey, updateJourney } = useAuthStore();
  const part = ETIQUETTE_PARTS[selectedPart];
  const PartIcon = ICON_MAP[part.icon] || BookOpen;

  // localStorage에서 체크 상태 로드
  useEffect(() => {
    const timer = window.setTimeout(() => {
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
    }, 0);
    return () => window.clearTimeout(timer);
  }, [part.number]);

  // localStorage에서 항목 메모 로드
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(`etiquette_memos_${part.number}`);
        setItemMemos(saved ? JSON.parse(saved) : {});
      } catch {
        setItemMemos({});
      }
    }, 0);
    return () => window.clearTimeout(timer);
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

  const findExistingScheduleEvent = useCallback((itemId: string, text: string) => {
    if (!journey?.progress) return undefined;
    const progress = journey.progress as unknown as Record<string, unknown>;
    const events = getEvents(progress);
    const sourceKey = getEtiquetteScheduleSourceKey(part.number, itemId);
    const legacyMemo = getLegacyEtiquetteEventMemo(part.number, part.title);
    const savedMemo = itemMemos[itemId]?.trim();

    return events.find((event) => event.sourceKey === sourceKey)
      ?? events.find((event) =>
        event.categoryKey === "etiquette"
        && event.memo === legacyMemo
        && (event.title === text || (!!savedMemo && event.title === savedMemo))
      );
  }, [journey, itemMemos, part.number, part.title]);

  // 일정 추가 팝오버 열기
  const handleOpenSchedule = useCallback((itemId: string, text: string) => {
    const existingEvent = findExistingScheduleEvent(itemId, text);
    setMemoPopover(null);
    setSchedulePopover({
      itemId,
      text,
      eventId: existingEvent?.id,
      initialDate: existingEvent?.date ?? "",
      initialMemo: getSchedulePopoverMemo(existingEvent, text, itemMemos[itemId]),
      isExisting: Boolean(existingEvent),
    });
  }, [findExistingScheduleEvent, itemMemos]);

  // 메모 팝오버 열기
  const handleOpenMemo = useCallback((itemId: string, text: string) => {
    setSchedulePopover(null);
    setMemoPopover({ itemId, text });
  }, []);

  // 항목 메모 저장
  const handleSaveMemo = useCallback((memo: string) => {
    if (!memoPopover) return;
    const trimmed = memo.trim();
    setItemMemos((prev) => {
      const next = { ...prev };
      if (trimmed) {
        next[memoPopover.itemId] = trimmed;
      } else {
        delete next[memoPopover.itemId];
      }
      try {
        localStorage.setItem(`etiquette_memos_${part.number}`, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
    setMemoPopover(null);
    setToast(trimmed ? "메모를 저장했습니다" : "메모를 삭제했습니다");
  }, [memoPopover, part.number]);

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

    await updateJourney({ progress: newProgress as typeof journey.progress });
    setSchedulePopover(null);
    setToast(schedulePopover.eventId ? "일정을 수정했습니다" : "일정에 추가되었습니다");
  }, [journey, updateJourney, schedulePopover, part.number]);

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
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-[300px] bg-ivory-50 flex flex-col h-full animate-fade-in">
            <div className="p-4 border-b border-black/[0.04] flex items-center justify-between">
              <p className="text-lg font-medium text-noir-800">전체 목록</p>
              <button onClick={() => setSidebarOpen(false)} className="p-1">
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
            {/* Part 23은 description이 빈 문자열이라 빈 줄이 그려졌다. */}
            {part.description.trim() && (
              <p className="text-[13px] font-medium leading-[1.65] text-[#5d6879]">
                {part.description}
              </p>
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
                          checkedItems={checkedItems}
                          itemMemos={itemMemos}
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
              initialMemo={itemMemos[memoPopover.itemId] || ""}
              onClose={() => setMemoPopover(null)}
              onSave={handleSaveMemo}
            />
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
            <Check className="w-5 h-5 text-[#795252]" />
            <p className="text-base font-medium text-[#1A1A1F]">{toast}</p>
          </div>
        </div>
      )}
    </div>
  );
}
