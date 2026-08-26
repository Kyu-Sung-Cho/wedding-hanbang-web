import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { weddingLinkProps } from "@/lib/weddingPaths";
import { noteSourceLink } from "@/lib/etiquette/noteSources";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";

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
 *
 * **같은 편이면 절 제목을, 다른 편이면 편 제목을 쓴다.** 근거 59개 중 46개는 분야 카드가
 * 이미 여는 그 편을 가리킨다. 거기에 **편** 제목을 달면 한 화면에 같은 줄이 일곱 번
 * 반복되고(혼인신고 분야가 그랬다), 정작 "이건 다른 편이다"라는 신호가 묻힌다.
 *
 * 그래서 한동안 그 46개를 전부 `근거 보기` 다섯 글자로 뒀는데, 그러면 반대쪽으로 무너진다 —
 * 혼인신고 모달에 **똑같은 「근거 보기」가 일곱 개** 늘어서고, 각각이 「가져갈 것」·「어디에
 * 내나요」·「신고를 마친 뒤 챙길 것」·「자녀의 성과 본」으로 흩어진다는 것을 화면이 말하지
 * 않는다. 무엇을 얻을지 모르는 링크는 눌리지 않는다.
 *
 * `noteSourceLink()` 는 절 제목을 이미 돌려주고 있었고 아무도 쓰지 않았다. 그걸 쓴다.
 *
 * **앞의 절 번호는 표시에서 벗긴다.** 25편 중 절 제목에 번호를 붙인 것은 5편뿐이라
 * (`invitation-sending`, `cost-saving` 등) 항목 밑에 `근거 · 5. 항목별로…` 가 뜨면 무엇의
 * 5번인지 그 화면이 설명하지 않는다. 조회 키는 원본 제목 그대로 두고 **표시만** 자른다 —
 * 키를 자르면 `noteSources` 의 절 조회가 통째로 깨진다.
 */

/** 표시용으로만 앞의 `5. ` 같은 절 번호를 벗긴다. 조회 키는 절대 이걸로 만들지 않는다. */
function withoutSectionNumber(heading: string): string {
  return heading.replace(/^\d+\.\s*/, "");
}
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

  // 항목 id의 앞자리가 분야 키다(`registration_05` → `registration`).
  const categoryKey = itemId.slice(0, itemId.lastIndexOf("_"));
  const categoryPart = mannersPartForCategory(categoryKey)?.slug;
  const sameAsCategoryCard = source.href.startsWith(`/manners/${categoryPart}#`);

  return (
    <Link
      {...weddingLinkProps(source.href)}
      className={`${indentClassName} mb-1 inline-flex w-fit items-center gap-1 rounded text-[13px] leading-[1.5] text-[#7A6A57] underline decoration-[#D9CBB4] underline-offset-4 hover:text-[#5A4D3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A96E]/50`}
    >
      {sameAsCategoryCard
        ? `근거 · ${withoutSectionNumber(source.heading)}`
        : `근거 · ${source.partTitle}`}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}
