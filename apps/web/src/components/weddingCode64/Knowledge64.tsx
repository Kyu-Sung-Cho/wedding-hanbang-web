// 웨딩 이해도: 큰 %, 단계 이름, L1~L4 칸, 1~3을 고른 문항 3개까지 '알아 두면 좋은 것'.
import { WC64_BANK } from "@/lib/weddingCode/wc64/bank";
import type { Wc64Knowledge } from "@/lib/weddingCode/wc64/types";
import { bodyClass, cardClass, h2Class, h3Class, linkClass, metaClass } from "./reportStyles";

const RUNG: Record<"pass" | "no" | "skip", string> = {
  pass: "bg-[#DFE6DA] [&_b]:text-[#4E5E50]",
  no: "bg-[var(--hb-surface-hover)]",
  skip: "border border-dashed border-[var(--hb-hairline)] bg-transparent",
};

export default function Knowledge64({ knowledge }: { knowledge: Wc64Knowledge }) {
  const checkedOn = WC64_BANK.meta.checked_on;
  return (
    <section className={cardClass} aria-labelledby="wc64-knowledge">
      <h2 id="wc64-knowledge" className={h2Class}>웨딩 이해도</h2>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-4xl font-bold leading-none tabular-nums text-[var(--hb-text-strong)]" data-testid="wc64-knowledge-pct">
            {knowledge.pct == null ? "·" : `${knowledge.pct}%`}
          </p>
          <p className={`mt-2 ${metaClass}`}>스스로 설명할 수 있다고 고른 정도예요. 맞히는 시험이 아니에요.</p>
        </div>
        {/* 0단계 이름(이제 첫걸음)은 "짚어 볼 수 있다"와 이어지지 않아 문장을 따로 둔다. */}
        <p className={bodyClass} data-testid="wc64-knowledge-stage">
          <b className="font-semibold text-[var(--hb-text-strong)]">{knowledge.stageName}</b>
          {knowledge.stage === 0 ? "이에요." : " 짚어 볼 수 있다고 고르셨어요."}
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="이해도 단계">
        {knowledge.levels.map(l => (
          <li key={l.L} className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-2.5 ${RUNG[l.state]}`} data-state={l.state}>
            <b className="text-[13px] font-semibold leading-5 text-[var(--hb-text-strong)]">{l.L} {l.name}</b>
            <span className="text-xs leading-5 text-[var(--hb-text-muted)]">
              {l.state === "skip" ? "건너뜀" : `${l.pct}% · ${l.state === "pass" ? "설명할 수 있어요" : "아직이에요"}`}
            </span>
          </li>
        ))}
      </ol>
      {knowledge.recheck.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className={h3Class}>알아 두면 좋은 것</h3>
          <p className={metaClass}>{WC64_BANK.meta.recheck_note}</p>
          {knowledge.recheck.map(it => (
            <div key={it.id} className="flex flex-col gap-1 rounded-r-lg border-l-[3px] border-[#B8794A] bg-[#FBEFE3] px-3 py-2.5 text-sm leading-7 text-[var(--hb-text-body)]">
              <b className="font-semibold text-[var(--hb-text-strong)]">{it.check_title}</b>
              <span>{it.check_note}</span>
              <span className={metaClass}>
                출처:{" "}
                {it.source_url
                  ? <a href={it.source_url} target="_blank" rel="noreferrer" className={linkClass}>{it.source}</a>
                  : it.source}
                {" "}· 확인 {checkedOn}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
