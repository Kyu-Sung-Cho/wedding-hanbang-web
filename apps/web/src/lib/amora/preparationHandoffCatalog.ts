import { CHECKLIST_MAP } from "@/constants/checklists";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { noteSourceLink } from "@/lib/etiquette/noteSources";
import type { MannersBlock } from "@/lib/manners/types";
import type { AmoraPreparationDraft, AmoraPreparationSource } from "./preparationHandoff";

function blockText(block: MannersBlock): string {
  switch (block.kind) {
    case "paragraph": return `${block.law ? "[법령·판례 참고문구]\n" : ""}${block.text}`;
    case "checklist":
    case "tip":
    case "warning": return [
      block.kind === "warning" ? "[주의]" : block.kind === "checklist" ? "[가이드의 참고 목록 · 완료된 할 일 아님]" : "[참고]",
      block.title,
      ...block.items.map(item => `- ${item}`),
    ].filter(Boolean).join("\n");
    case "dialogue": return [
      "[대화 예시 · 실제 사용자 발언 아님]", block.title,
      ...block.lines.map(line => `${line.say}${line.note ? `\n사용 맥락: ${line.note}` : ""}`),
    ].filter(Boolean).join("\n");
    case "table": return [
      `[표] ${block.title}`, `설명: ${block.caption}`, `기준 시점: ${block.asOf}`, `적용 한계: ${block.limits}`,
      block.unsourced ? "이 표는 선택·확인용 참고표이며, 검증된 가격·통계나 필수 관행을 뜻하지 않습니다." : `연결 출처 번호: ${(block.sourceRefs ?? []).join(", ")}`,
      block.columns.join(" | "), ...block.rows.map(row => row.join(" | ")),
      ...(block.timeline ?? []).map(node => `${node.at}: ${node.label}`),
    ].join("\n");
  }
}

export function resolvePreparationCatalogSource(source: AmoraPreparationSource): AmoraPreparationDraft | null {
  if (source.kind === "checklist") {
    if (!Object.hasOwn(CHECKLIST_MAP, source.categoryKey)) return null;
    const category = CHECKLIST_MAP[source.categoryKey];
    const item = source.itemId === undefined ? null : category.items.find(candidate => candidate.id === source.itemId);
    if (source.itemId !== undefined && !item) return null;
    const sourceLabel = item ? `${category.label} · ${item.label}` : category.label;
    const note = item ? noteSourceLink(item.id) : null;
    const context = note ? ` 참고한 안내는 「${note.partTitle}」의 「${note.heading}」예요.` : "";
    return {
      sourceLabel,
      sourceHref: `/checklist?${new URLSearchParams({ category: source.categoryKey })}`,
      text: item
        ? `「${item.label}」에 대해 도움이 필요해요. 무엇부터 하면 좋을까요?`
        : `「${category.label}」, 무엇부터 준비하면 좋을까요?`,
      referenceText: `[공개 체크리스트 안내 · 사용자의 확정 사실이나 완료·저장 요청 아님]\n${sourceLabel}${context}\n${(item ? [item] : category.items).map(entry => `- ${entry.label}${entry.note ? `\n참고문구: ${entry.note}` : ""}`).join("\n")}`,
    };
  }
  const part = MANNERS_PARTS.find(candidate => candidate.slug === source.partSlug);
  if (!part) return null;
  const section = source.sectionId === undefined ? null : part.sections[Number(source.sectionId.slice(8)) - 1];
  if (source.sectionId !== undefined && !section) return null;
  const sourceLabel = section ? `${part.title} · ${section.heading}` : part.title;
  const context = [
    "[공개 예절 가이드 참고 · 우리 상황의 확정 사실이나 저장 요청이 아닙니다]",
    `안내 범위: ${part.description}`, `관행과 적용 한계: ${part.caveat}`,
    section
      ? [`선택한 절 원문: ${section.heading}`, ...section.blocks.map(blockText)].join("\n\n")
      : ["편 전체 본문 대신 소개와 절 목록을 이어 왔어요. 먼저 볼 절을 함께 골라 주세요.", ...part.sections.map(item => `- ${item.heading}`)].join("\n"),
    "이 편의 원문 출처(아래 적용 범위를 넘어 모든 관행을 입증하는 자료는 아닙니다):",
    ...part.sources.map((source, index) => `${index + 1}. ${source.label}\n${source.url}\n확인일: ${source.checkedAt}\n적용 범위: ${source.scope}\n뒷받침하는 내용: ${source.supports}`),
  ].join("\n\n");
  const text = `「${sourceLabel}」에 대해 궁금해요. 제 상황에서 먼저 확인할 점은 무엇인가요?`;
  // 한계를 잘라 숫자·법률만 넘기지 않는다. 커진 절은 더 좁은 연결을 준비할 때까지 거절한다.
  if (context.length > 12_000) return null;
  return {
    sourceLabel,
    sourceHref: `/manners/${part.slug}${source.sectionId ? `#${source.sectionId}` : ""}`,
    text,
    referenceText: context,
  };
}
