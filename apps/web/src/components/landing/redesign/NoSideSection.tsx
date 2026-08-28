import { BloomSprig } from "./LandingBloom";
import { landingContent } from "./landingContent";
import { Section, bodyText, noteText } from "./notebook";

/**
 * ② 편을 들지 않는다.
 *
 * "ChatGPT 한테 물어보면 되잖아요?" 를 우리가 먼저 묻는다. 처음 온 사람이 반드시
 * 하는 질문이고, 우리가 안 물으면 그 사람은 답을 못 얻은 채 나간다.
 *
 * 인용한 계약은 `lib/ai/amoraVoice.ts:21-22` 다. 조건 분기 없이 **모든** 시스템
 * 프롬프트에 들어가므로(`lib/ai/prompts.ts:13, 1003`) "언제나"라고 써도 참이다.
 * 이건 성능이 아니라 제품 결정이라 모델이 좋아진다고 경쟁자가 따라오지 않는다.
 *
 * AI 고지는 이 섹션에 반드시 남는다 — 여기가 아모라를 처음 소개하는 자리다.
 */
export default function NoSideSection() {
  const { noSide } = landingContent;

  return (
    <Section id="noside" eyebrow={noSide.eyebrow} title={noSide.title} className="relative">
      <BloomSprig className="pointer-events-none absolute -left-24 bottom-0 hidden h-[300px] w-[236px] opacity-60 xl:block" />
      <div className="mt-8 max-w-[54ch] space-y-5">
        <p className={bodyText}>{noSide.body}</p>
        <p className={bodyText}>{noSide.body2}</p>
      </div>
      <p className={`mt-6 ${noteText}`}>{noSide.note}</p>
    </Section>
  );
}
