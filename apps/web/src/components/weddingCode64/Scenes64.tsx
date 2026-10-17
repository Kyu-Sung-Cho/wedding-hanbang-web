// 결혼 준비 장면에서: 장면마다 이어진 글자로 본 모습과 도움이 되는 한 가지.
// 글자가 아슬·반반이거나, 장면이 그리는 묶음을 글자와 다른 쪽으로 답했으면 두 쪽을 섞은 half 문구가 온다(model.ts sceneResults).
// 넘긴 묶음의 장면은 model 이 빼고 넘겨준다.
import { wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import type { Wc64FacetPos, Wc64SceneResult } from "@/lib/weddingCode/wc64/types";
import { LEVEL_TEXT, bodyClass, cardClass, h2Class, h3Class, isShaky, levelChipClass, metaClass, quoted } from "./reportStyles";

/** 글자는 또렷한데 묶음 답이 글자와 달라 half 문구를 쓴 까닭 */
const FACET_MIX_REASON: Record<Exclude<Wc64FacetPos, "same">, string> = {
  opp: "글자와 반대쪽으로 고르셔서",
  mid: "가운데에 가깝게 고르셔서",
  "both-high": "두 쪽 문장에 비슷하게 답하셔서",
  "both-low": "두 쪽 문장에 비슷하게 답하셔서",
};

function facetMixLine(sc: Wc64SceneResult): string | null {
  if (sc.key !== "half" || isShaky(sc.level) || !sc.facetPos || sc.facetPos === "same") return null;
  const title = wc64SectionById(sc.section)?.title;
  if (!title) return null;
  return `${quoted(title)}에서 ${FACET_MIX_REASON[sc.facetPos]}, 이 장면은 두 쪽 모습을 섞어 보여 드려요.`;
}

export default function Scenes64({ scenes }: { scenes: readonly Wc64SceneResult[] }) {
  return (
    <section className={cardClass} aria-labelledby="wc64-scenes">
      <h2 id="wc64-scenes" className={h2Class}>결혼 준비 장면에서</h2>
      {/*
        옛 줄 '…함께 보고 골랐어요'는 앱이 고른 방법을 설명하는 말투였고, '이어진 글자'는 무엇인지 알 수 없었고, 다른 화면이 '문장'이라 부르는
        것을 여기만 '질문'이라 불렀다(재판정). 글자는 장면 제목 옆 말(levelChipClass)에 적혀 있다.
      */}
      <p className={metaClass} data-testid="wc64-scenes-intro">장면 글은 제목 옆에 적힌 글자와, 그 장면에 해당하는 문장에서 고른 답에 따라 달라져요. 장면마다 맨 아래 줄은 해 볼 일이에요.</p>
      <div className="flex flex-col">
        {scenes.map(sc => {
          const mix = facetMixLine(sc);
          return (
            <article
              key={sc.id}
              className="flex flex-col gap-1.5 border-t border-[var(--hb-hairline)] py-3"
              data-scene={sc.id}
              data-scene-key={sc.key}
              data-scene-facet-pos={sc.facetPos ?? "none"}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={h3Class}>{sc.title}</h3>
                <span className={levelChipClass(sc.level)}>{sc.letter} {sc.letterPct}% · {LEVEL_TEXT[sc.level]}</span>
              </div>
              {mix && <p className={metaClass} data-scene-mix={sc.id}>{mix}</p>}
              <p className={bodyClass}>{sc.here}</p>
              <p className="text-sm leading-7 text-[#4E5E50]">{sc.tip}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
