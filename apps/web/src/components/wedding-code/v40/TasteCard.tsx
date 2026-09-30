"use client";

import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { buttonFocusFix, cx, srOnly } from "./styles";
import { bodyLine, panel, sectionTitle } from "./resultStyles";

/**
 * next/link 의 미리 불러오기 끄기. 공용 Button 이 안쪽 주소를 next/link 로 그리고, 남는 속성을 그대로 넘겨 주는 것을 쓴다.
 * 링크가 화면에 들어올 때 운영 빌드가 그 쪽을 미리 요청하면 「v4 화면은 서버 요청이 없다」는 약속이 깨진다.
 */
const NO_PREFETCH = { prefetch: false } as const;

export interface TasteCardProps {
  /**
   * 누르면 부른다. 이용 통계(이미 고지된 wedding_code_taste_clicked, placement result)와 이동은 부모가 한다.
   * href 를 함께 주면 단추가 링크가 되고 이 함수는 눌렀다는 사실만 알린다(이동을 막지 않는다).
   */
  readonly onOpen: () => void;
  /** 코드와 분리한 취향 2부 주소. 주면 링크로 그려서 새 탭 열기와 주소 복사가 된다. */
  readonly href?: string;
  readonly idPrefix?: string;
}

/**
 * 결혼식 모습도 골라 볼까요? (선택) 카드. 취향은 코드와 분리한 선택 2부라서 안 해도 코드는 그대로라고 알린다.
 * 취향을 코드나 링크에 섞지 않는다.
 */
export function TasteCard({ onOpen, href, idPrefix = "wc40-taste" }: TasteCardProps) {
  const titleId = `${idPrefix}-title`;
  return (
    <section data-result-section="taste" aria-labelledby={titleId} className={cx(panel, "space-y-2")}>
      <h2 id={titleId} className={sectionTitle}>
        {V40_COPY.taste.title}
      </h2>
      <p className={bodyLine}>{V40_COPY.taste.body}</p>
      {href ? (
        // 링크는 next/link 가 그려서 화면에 들어오면 미리 불러온다(서버 요청). 이 화면은 요청이 없어야 하므로 미리 불러오기를 끈다.
        // 새 탭에서 열어 자동 저장을 끈 채로 보던 결과가 사라지지 않게 한다.
        <Button variant="secondary" href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} className={buttonFocusFix} {...NO_PREFETCH}>
          {V40_COPY.taste.button}
          <span className={srOnly}> ({V40_COPY.taste.newTabHint})</span>
        </Button>
      ) : (
        <Button variant="secondary" onClick={onOpen} className={buttonFocusFix}>
          {V40_COPY.taste.button}
        </Button>
      )}
    </section>
  );
}

export default TasteCard;
