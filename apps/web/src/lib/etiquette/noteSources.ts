import { CHECKLIST_NOTE_SOURCES } from "@hanbang/shared/constants";
import { MANNERS_PARTS } from "@/lib/manners/data";

/**
 * 항목과 근거의 대응은 웹·모바일 공유 목록에서 읽는다.
 * 웹 앵커는 기존처럼 실제 절 제목으로 찾는다. 공유 절 번호가 낡거나
 * 편의 순서가 바뀌어도 엉뚱한 절을 가리키지 않으며, 전수 테스트가 불일치를 잡는다.
 */
export type NoteSourceLink = {
  href: string;
  partTitle: string;
  heading: string;
};

/** 항목 id로 근거 링크를 찾는다. 편이나 절 제목이 어긋나면 `null`(테스트가 잡는다). */
export function noteSourceLink(itemId: string): NoteSourceLink | null {
  const source = CHECKLIST_NOTE_SOURCES[itemId];
  if (!source) return null;

  const part = MANNERS_PARTS.find((candidate) => candidate.slug === source.part);
  if (!part) return null;

  const index = part.sections.findIndex((section) => section.heading === source.heading);
  if (index < 0) return null;

  return {
    href: `/manners/${part.slug}#section-${index + 1}`,
    partTitle: part.title,
    heading: source.heading,
  };
}

/** 근거가 적힌 항목 id 전부. 테스트가 전수 검사에 쓴다. */
export function noteSourceItemIds(): string[] {
  return Object.keys(CHECKLIST_NOTE_SOURCES);
}
