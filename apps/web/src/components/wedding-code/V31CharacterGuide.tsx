import type { V31Draft } from "@/constants/weddingCodeV31";
import { buildV31StyleSummary } from "@/lib/weddingCode/v31StyleSummary";
import { v31Character, v31CoupleGuide, v31ExploreQuestion, v31PersonalGuide } from "@/lib/weddingCode/v31CharacterGuide";
import { CharacterPortrait } from "./CharacterPortrait";

const surface = "mt-5 rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] p-5 sm:p-7";
const body = "text-sm leading-7 text-[var(--hb-text-body)]";
/** Reuse artwork by animal name only, never by translated answer/code or v4 result. */
const PORTRAIT_BY_ANIMAL: Record<string, number> = { 사슴: 6, 곰: 3, 고양이: 0, 강아지: 11, 토끼: 8, 비버: 1, 판다: 14, 거북이: 7,
  여우: 5, 돌고래: 9, 코알라: 13, 펭귄: 2, 알파카: 10, 다람쥐: 12, 부엉이: 4, 코끼리: 15 };

export function V31PersonalCharacterGuide({ draft, label }: { draft: V31Draft; label?: string }) {
  const summary = buildV31StyleSummary(draft); const character = v31Character(draft);
  return <section className={surface} data-v31-character-guide data-character-code={character?.code}>
    <div className="flex flex-wrap items-center gap-4">{character ? <CharacterPortrait index={PORTRAIT_BY_ANIMAL[character.animal]} /> : null}<div className="min-w-0 flex-1">
      <p className="text-xs text-[var(--hb-text-muted)]">{label ? `${label}의 답변을 기억하는 별칭` : "내 답변을 기억하는 별칭"}</p>
      <h2 className="mt-2 text-xl font-semibold text-[var(--hb-text-strong)]">{character ? `${character.adjective} ${character.animal}` : "아직 한 별칭으로 묶지 않아요"}</h2>
      <p className={`mt-2 ${body}`}>별칭은 답변 요약을 기억하기 위한 이름이에요. 동물은 설명을 돕는 표시일 뿐이며, 다시 답하면 달라질 수 있어요.</p>
    </div></div>
    {!character ? <p className={`mt-3 ${body}`}>두 방식에 모두 동의하거나, 경계에 있거나, 아직 답이 부족한 부분은 한 유형으로 정하지 않아요. 아래 원문 답과 준비 제안을 함께 봐요.</p> : null}
    <div className="mt-5 grid gap-5 sm:grid-cols-2">{summary.dimensions.map(axis => {
      const guide = v31PersonalGuide(axis);
      return <section key={axis.key} data-v31-guide-axis={axis.key}><h3 className="font-semibold">{axis.title}</h3>
        {guide ? <dl className={`${body} mt-2 space-y-2`}><dt className="font-semibold">답변에서 살릴 점</dt><dd>{guide.strength}</dd>
          <dt className="font-semibold">확인해둘 점</dt><dd>{guide.caution}</dd><dt className="font-semibold">한 가지 해보기</dt><dd>{guide.action}</dd>
          <dt className="font-semibold">이렇게 말해 보기</dt><dd><blockquote>“{guide.say}”</blockquote></dd></dl>
          : <><p className={`mt-2 ${body}`}>이 부분은 한쪽 방식의 강점·주의점으로 해석하지 않아요. 두 문장에서 고른 답을 먼저 확인해 보세요.</p>
            <p className={`mt-2 ${body}`} data-v31-explore={axis.key}>{v31ExploreQuestion(axis)}</p></>}
        <details className={`mt-3 ${body}`}><summary className="min-h-11 cursor-pointer underline underline-offset-4">어떤 답에 근거했나요?</summary>
          <ul className="space-y-2">{axis.items.map(item => <li key={item.id} data-v31-guide-evidence={item.id}>{item.statement}<br /><strong>{item.responseLabel}</strong></li>)}</ul>
        </details></section>;
    })}</div>
  </section>;
}

export function V31CoupleCharacterGuide({ first, second, labels }: { first: V31Draft; second: V31Draft; labels: { first: string; second: string } }) {
  return <section className={surface} data-v31-couple-guide><h2 className="text-xl font-semibold">둘이 해볼 준비와 말투</h2>
    <p className={`mt-2 ${body}`}>별칭이 같아도 실제 답은 다를 수 있어요. 같은 문장에서 각자 고른 답을 근거로 이야기해 봐요.</p>
    <div className="mt-4 grid gap-5 sm:grid-cols-2">{v31CoupleGuide(first, second).map(row => <section key={row.key}>
      <h3 className="font-semibold">{row.title}</h3><p className={`mt-2 ${body}`}>{row.observation}</p>
      {row.supported ? <><p className={`mt-2 ${body}`}>{row.action}</p><blockquote className={`mt-2 ${body}`}>“{row.say}”</blockquote></> : null}
      <details className={`mt-3 ${body}`}><summary className="min-h-11 cursor-pointer underline underline-offset-4">두 사람의 실제 답 보기</summary>
        {row.first.items.map((item, index) => <div key={item.id} className="mt-3" data-v31-pair-evidence={item.id}>
          <p>{item.statement}</p><p>{labels.first}: {item.responseLabel}</p><p>{labels.second}: {row.second.items[index].responseLabel}</p>
        </div>)}
      </details></section>)}</div>
  </section>;
}
