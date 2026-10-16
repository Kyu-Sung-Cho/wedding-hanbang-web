// 결혼 준비 장면에서: 장면마다 이어진 글자로 본 모습과 도움이 되는 한 가지(아슬·반반이면 half 문구).
import type { Wc64SceneResult } from "@/lib/weddingCode/wc64/types";
import { LEVEL_TEXT, bodyClass, cardClass, h2Class, h3Class, levelChipClass, metaClass } from "./reportStyles";

export default function Scenes64({ scenes }: { scenes: readonly Wc64SceneResult[] }) {
  return (
    <section className={cardClass} aria-labelledby="wc64-scenes">
      <h2 id="wc64-scenes" className={h2Class}>결혼 준비 장면에서</h2>
      <p className={metaClass}>장면마다 이어진 글자로 보면 이래요. 아래 줄은 도움이 되는 한 가지예요.</p>
      <div className="flex flex-col">
        {scenes.map(sc => (
          <article key={sc.id} className="flex flex-col gap-1.5 border-t border-[var(--hb-hairline)] py-3" data-scene={sc.id} data-scene-key={sc.key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={h3Class}>{sc.title}</h3>
              <span className={levelChipClass(sc.level)}>{sc.letter} {sc.letterPct}% · {LEVEL_TEXT[sc.level]}</span>
            </div>
            <p className={bodyClass}>{sc.here}</p>
            <p className="text-sm leading-7 text-[#4E5E50]">{sc.tip}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
