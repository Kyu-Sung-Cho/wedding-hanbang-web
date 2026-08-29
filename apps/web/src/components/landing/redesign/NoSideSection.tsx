import { landingContent } from "./landingContent";
import { Section, bodyText, noteText } from "./notebook";

/**
 * "ChatGPT한테 물어보면 되잖아요?" 에 답한다.
 *
 * ## 이 섹션이 파는 것은 기능이 아니다
 *
 * **하지 않기로 한 것**을 판다. 편을 들지 않는 건 못 하는 게 아니라 선택이고,
 * 그게 범용 챗봇과 갈리는 자리다. 그래서 눈썹이 서술이 아니라 **방문자가 실제로
 * 하는 질문**이다 — 운영 랜딩이 이 구조로 되어 있고, 2026-08-29 개편에서 그걸
 * 잃었다가 되돌렸다.
 *
 * ## AI 고지가 여기 붙는 이유
 *
 * 이 섹션이 **아모라를 처음 소개하는 자리**다("계정을 만들면 결혼 준비 동반자
 * 아모라와 이야기할 수 있어요"). AI 기본법상 사람인 것처럼 소개할 수 없으므로
 * 소개 문장과 고지가 같은 자리에 있어야 한다 —
 * `landingAmoraGate.test.ts` 가 그 짝을 고정한다.
 *
 * ⚠️ 첫 문장은 **계정 관문이 있다**고 말한다(계정을 만들어야 아모라와 이야기한다).
 * 오늘 사실이다 — 비로그인 체험은 2026-08-27에 닫혔다. 같은 파일의 `APPROVED`
 * 목록에 올라가 있으니 문장을 바꾸면 그쪽도 함께 고쳐라.
 */
export default function NoSideSection() {
  const { noSide } = landingContent;

  return (
    <Section id="noside" eyebrow={noSide.eyebrow} title={noSide.title} tinted>
      <div className="mt-8 grid gap-7 lg:grid-cols-2 lg:gap-12">
        <p className={bodyText}>{noSide.body}</p>
        <p className={bodyText}>{noSide.body2}</p>
      </div>
      <p className={`mt-8 max-w-[60ch] ${noteText}`}>{noSide.note}</p>
    </Section>
  );
}
