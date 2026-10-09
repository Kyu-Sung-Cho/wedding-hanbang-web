import type { DomainProfile, FacetProfile, PersonalSceneReading, SupportSceneProfile } from "@/lib/weddingCode/likert/model";
import { LETTER_DEFINITIONS, SCALE, type Answer, type Domain, type Facet } from "@/lib/weddingCode/likert/types";

export function responseLabel(answer: Answer | null | undefined): string {
  if (!answer) return "아직 응답하지 않음";
  if (answer.status === "rated") return `${answer.value} · ${SCALE.find(option => option.value === answer.value)?.label ?? ""}`;
  if (answer.status === "unknown") return "잘 모르겠어요";
  if (answer.status === "not_applicable") return "해당하지 않아요";
  return "건너뜀";
}

export function SceneReadingEvidence({ reading }: { reading: PersonalSceneReading }) {
  return (
    <div className="mt-4 space-y-4 text-sm leading-7" data-scene-reading={reading.sceneId}>
      <div><p className="font-semibold">관찰한 응답</p><p className="mt-1 text-[var(--hb-text-body)]">{reading.observation}</p></div>
      {reading.possibleReading && <div><p className="font-semibold">이렇게 읽어 볼 수 있어요</p><p className="mt-1 text-[var(--hb-text-body)]">{reading.possibleReading}</p><p className="mt-1 text-xs leading-6 text-[var(--hb-text-muted)]">이 문항의 조건에서 읽어 보는 설명이에요. 내가 떠올린 이유와 맞는지 직접 확인해 주세요.</p></div>}
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">이 읽기를 만든 질문과 내 응답</summary>
        <dl className="mt-2 divide-y divide-[var(--hb-hairline)]">
          {reading.entries.map(({ item, answer }) => <div key={item.id} className="py-3 first:pt-0 last:pb-0"><dt className="text-[var(--hb-text-body)]">{item.text}</dt><dd className="mt-1 font-semibold">{responseLabel(answer)}</dd></div>)}
        </dl>
      </details>
      <div><p className="font-semibold">내가 확인해 볼 점</p><p className="mt-1 text-[var(--hb-text-body)]">{reading.selfCheck}</p></div>
      {reading.partnerRequest && <div><p className="font-semibold">상대에게 부탁할 말</p><blockquote className="mt-2 border-l-2 border-[var(--hb-primary)] pl-4 text-[var(--hb-text-body)]">{reading.partnerRequest}</blockquote><p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">실제로 동의한 문장에서 만든 요청 초안이에요. 현재 조건과 상대가 가능한 범위는 함께 확인해요.</p></div>}
    </div>
  );
}

export function facetName(facet: Facet): string {
  if (facet === "together_rest") return "함께 쉬기";
  if (facet === "alone_rest") return "혼자 쉬기";
  return LETTER_DEFINITIONS[facet].name;
}

export function EndorsementRatio({ facet }: { facet: FacetProfile | undefined }) {
  const ratio = facet?.ratio;
  return (
    <p aria-label="동의한 응답 비율" className="mt-3 text-sm leading-6 text-[var(--hb-text-body)]">
      {ratio && ratio.percent !== null ? (
        <><span className="text-xl font-semibold tabular-nums text-[var(--hb-text-strong)]">{Math.round(ratio.percent)}%</span>{" "}
          <span className="tabular-nums">({ratio.numerator}/{ratio.denominator}개)</span>{" · 1~5로 답한 문장 중 4·5로 동의한 비율"}</>
      ) : "비율을 계산할 응답 없음 · 1~5로 답한 문장이 아직 없어요"}
    </p>
  );
}

export function RatioExplanation() {
  return <p className="mt-4 text-xs leading-6 text-[var(--hb-text-muted)]">두 방향을 따로 물었으므로 두 비율의 합이 100%일 필요는 없어요. 모름·비해당·건너뜀·미응답은 분모에 넣지 않았어요. 소수는 가장 가까운 정수로 표시해요. 대표 글자는 별도로 장면별 두 응답을 비교해 정해요.</p>;
}

const selfChecks: Record<Domain, string> = {
  money: "각 문장에 이렇게 답한 이유는 무엇인가요? 아직 확인할 조건은 무엇이고, 실제 추가 비용이나 기본 구성이 달라지면 답도 달라질까요?",
  process: "자료를 직접 보고 싶은 마음과 후보 분담을 받아들이는 마음이 함께 있다면, 어떤 자료를 받고 누가 후보를 추리면 좋을까요?",
  family: "가족에게 확인하고 싶은 내용과 두 사람이 정리하고 싶은 기준을 각각 한 가지씩 말해 볼까요?",
  support: "오늘의 피로와 남은 일이 달라지면 어떤 도움을 먼저 부탁하고 싶나요? 듣고 싶은 반응과 정리할 일을 직접 설명해 보세요.",
};

export function DomainEvidence({ profile, readings = [] }: { profile: DomainProfile; readings?: PersonalSceneReading[] }) {
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-[var(--hb-text-strong)]">내가 확인해 볼 점</p>
      <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{selfChecks[profile.domain]}</p>
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]">장면별로 이 글자가 나온 이유 보기</summary>
        <div className="mt-3 divide-y divide-[var(--hb-hairline)]">
          {profile.scenes.map(scene => {
            const reading = readings.find(entry => entry.sceneId === scene.sceneId);
            return (
            <article key={scene.sceneId} className="py-4 first:pt-0">
              <h4 className="text-sm font-semibold">{scene.title}</h4>
              <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">{scene.summary}</p>
              <p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">
                {scene.missing ? "두 문장의 1~5 응답이 모두 있지 않아 대표 표에 넣지 않았어요."
                  : scene.winner ? `이 장면은 ${scene.winner} 대표 표 한 개에 포함됐어요.`
                    : "이 장면은 어느 글자에도 대표 표를 더하지 않았어요. 두 원답은 그대로 남겼어요."}
              </p>
              {reading && <SceneReadingEvidence reading={reading} />}
            </article>
            );
          })}
        </div>
      </details>
    </div>
  );
}

export function SupportReading({ scene }: { scene: SupportSceneProfile }) {
  const counts = scene.responseCounts;
  const summary = scene.endorsed.length > 0
    ? `4·5로 답한 도움: ${scene.endorsed.map(facetName).join(" · ")}`
    : counts.notApplicable === scene.entries.length
      ? "모든 문장을 비해당으로 남겼어요. 이 장면에서 원하는 도움을 정하지 않았어요."
      : counts.rated === 0
        ? "아직 확인하지 않은 응답이 있어요. 이 장면에서 원하는 도움을 정하지 않았어요."
        : counts.rated < scene.entries.length
          ? "답한 문장 중 4·5로 동의한 응답은 없어요. 나머지 응답은 아직 확인이 필요해요."
          : "네 문장에 4·5로 동의한 응답이 없어요. 다른 도움을 원할 수도 있어요.";
  const hasBothRest = scene.endorsed.includes("together_rest") && scene.endorsed.includes("alone_rest");
  return (
    <div>
      <p className="mt-3 text-sm font-medium leading-7 text-[var(--hb-text-strong)]">{summary}</p>
      <p className="mt-2 text-xs leading-6 text-[var(--hb-text-muted)]">
        1~5 응답 {counts.rated}/{scene.entries.length}개 · 낮은 동의(1·2) {counts.low}개 · 보통(3) {counts.middle}개
        {" · "}모름 {counts.unknown}개 · 비해당 {counts.notApplicable}개 · 건너뜀 {counts.skipped}개 · 미응답 {counts.unanswered}개
      </p>
      {hasBothRest && <p className="mt-2 text-sm leading-7 text-[var(--hb-text-body)]">함께 쉬기와 혼자 쉬기에 모두 동의했어요. 지금 어떤 방식부터 해 보고 싶은지 직접 정해 주세요.</p>}
    </div>
  );
}
