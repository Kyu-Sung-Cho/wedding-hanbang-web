import { landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText, ruled } from "./notebook";

/**
 * ④ 나만 보는 자리.
 *
 * ③ 을 읽은 사람이 곧바로 하는 걱정 — "그럼 내가 쓴 게 다 상대한테 가나?" — 을
 * 바로 다음 섹션에서 받는다. 순서를 바꾸면 ③ 이 불안으로 끝난다.
 *
 * "안전하다"고 단정하지 않는다. 저장은 되고, 연결된 배우자 화면에 안 보일 뿐이다.
 * 그 이상을 약속하면 개인정보 문장이 거짓이 된다.
 */
export default function PrivateLaneSection() {
  const { privateLane } = landingContent;

  return (
    <Section id="private" eyebrow={privateLane.eyebrow} title={privateLane.title}>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {[
          {
            tag: "함께 보는 자리",
            body: "예식장·예산처럼 둘이 정해야 하는 이야기. 두 분 화면에 같이 남아요.",
          },
          {
            tag: "나만 보는 자리",
            body: "혼자 정리하고 싶은 고민. 연결된 배우자 화면에는 표시하지 않아요.",
          },
        ].map((lane) => (
          <NoteCard key={lane.tag} tilt={lane.tag.startsWith("함께") ? -0.4 : 0.4}>
            <p className="landing-hand text-[18px] text-[var(--color-paper-pen)]">{lane.tag}</p>
            <p className={`mt-1 ${ruled}`}>{lane.body}</p>
          </NoteCard>
        ))}
      </div>
      <p className={`mt-7 max-w-[54ch] ${bodyText}`}>{privateLane.body}</p>
      <p className={`mt-5 ${noteText}`}>{privateLane.note}</p>
    </Section>
  );
}
