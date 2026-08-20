import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { weddingLinkProps } from "@/lib/weddingPaths";
import { noteSourceLink } from "@/lib/etiquette/noteSources";

/**
 * 항목 안내가 어디서 나왔는지로 가는 링크.
 *
 * 분야 카드가 여는 예절 편은 분야마다 하나로 정해져 있어서, 다른 편에서 온 안내는 그 편으로
 * 갈 길이 없었다. 「결혼 비용 절약 가이드」는 19개 분야 어디서도 열리지 않는데 계약 안내
 * 여러 개의 근거다. 그래서 안내 바로 밑에 그 절로 가는 길을 둔다.
 *
 * **체크박스 밖에 두어야 한다.** 항목은 `<button role="checkbox">`라서 그 안에 링크를 넣으면
 * 잘못된 마크업이고, 누를 때 무엇이 실행될지도 애매해진다. 호출부는 이 컴포넌트를 버튼의
 * 형제로 둔다.
 *
 * 근거가 없는 항목에서는 아무것도 그리지 않는다 — 무엇을 물어보라는 안내에는 댈 근거가 없다.
 */
export default function ChecklistItemSource({
  itemId,
  indentClassName = "ml-9",
}: {
  itemId: string;
  /** 체크 아이콘 너비만큼 안쪽으로 — 화면마다 아이콘 크기가 달라 밖에서 받는다. */
  indentClassName?: string;
}) {
  const source = noteSourceLink(itemId);
  if (!source) return null;

  return (
    <Link
      {...weddingLinkProps(source.href)}
      className={`${indentClassName} mb-1 inline-flex w-fit items-center gap-1 rounded text-[13px] leading-[1.5] text-[#7A6A57] underline decoration-[#D9CBB4] underline-offset-4 hover:text-[#5A4D3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A96E]/50`}
    >
      근거 · {source.partTitle}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}
