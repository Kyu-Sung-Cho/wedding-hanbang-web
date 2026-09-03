import { landingContent } from "./landingContent";
import { band, bodyText, eyebrowText, noteText, sectionTitle, shell } from "./notebook";

/**
 * ⑤ 대화로 끝나지 않게 — 정한 것이 **어디로 가는지.**
 *
 * 2026-09-03 시안: 도구 카드 셋(예산·할 일·일정) + 넓은 확인 카드 한 장.
 *
 * ## 확인 카드가 제품 계약을 진다
 *
 * 아모라가 이해한 것을 **먼저 보여주고**, 사람이 누르기 전에는 아무것도 바뀌지 않는다.
 * 그래서 카드 안에 세 가지가 함께 있어야 한다: 무엇으로 이해했는지(칩+문장),
 * 무엇을 고를 수 있는지(버튼 셋), 그리고 **아직 아무 일도 안 일어났다는 사실**.
 *
 * ## 버튼 셋은 그림이다
 *
 * 이 화면에서 누를 수 있는 것은 아무것도 없다(계정이 있어야 아모라를 쓴다). 그래서
 * `aria-hidden` 으로 묶는다 — 안 그러면 스크린리더가 진짜 승인 버튼으로 읽어
 * "여기서 저장했다"고 오해하게 만든다.
 *
 * 샘플 표식(`sampleNote`)은 카드 **안**에 둔다. 바깥으로 빼면 카드만 캡처해 공유했을 때
 * 그 사실이 떨어져 나간다.
 */
export default function ConfirmSection() {
  const { confirm } = landingContent;

  return (
    <section id="confirm" className={band} aria-labelledby="confirm-title">
      <div className={shell}>
        <p className="mb-5">
          <span className={eyebrowText}>
            {confirm.eyebrow}
          </span>
        </p>

        <h2 id="confirm-title" className={sectionTitle}>
          {confirm.title}
        </h2>

        <p className={`mt-7 max-w-[52ch] ${bodyText}`}>{confirm.lede}</p>

        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {confirm.tools.map((tool) => (
            <li
              key={tool.title}
              className="rounded-[12px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] px-6 py-6"
            >
              <p className="text-[18px] font-semibold text-[var(--color-paper-ink)]">
                {tool.title}
              </p>
              <p className={`mt-2 ${noteText}`}>{tool.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-[12px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] px-6 py-7 shadow-raised sm:px-8">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-[var(--color-paper-ink-faint)]">
            <span className="flex items-center gap-2">
              <span aria-hidden>☆</span>
              <span>{confirm.sample.cardTitle}</span>
            </span>
            {/* 아직 아무 일도 일어나지 않았다는 표시. 시안에는 없지만 이 카드가
                이미 저장된 화면으로 읽히면 안 되기 때문에 넣는다. */}
            <span className="font-medium text-[var(--color-paper-ink-faint)]">
              {confirm.sample.saidLabel} · {confirm.sample.state}
            </span>
          </p>

          <ul className="mt-5">
            {confirm.sample.rows.map((row, index) => (
              <li
                key={row.text}
                className={
                  index === 0
                    ? "flex items-center gap-4 py-3"
                    : "flex items-center gap-4 border-t border-[var(--color-paper-divider)] py-3"
                }
              >
                <span className="inline-flex min-w-[52px] justify-center rounded-full bg-[var(--color-paper-tint)] px-3 py-1 text-[12px] font-semibold text-[var(--color-paper-ink-faint)]">
                  {row.chip}
                </span>
                <span className="text-[16px] leading-[1.6] text-[var(--color-paper-ink)]">
                  {row.text}
                </span>
              </li>
            ))}
          </ul>

          {/* 진짜 버튼이 아니다. 눌리지 않는 그림이라는 걸 보조기기에도 알려야 한다. */}
          <div className="mt-5 flex flex-wrap gap-2" aria-hidden="true">
            <span className="inline-flex min-h-9 items-center rounded-[6px] bg-[var(--color-paper-ink)] px-4 text-[14px] font-semibold text-[var(--color-paper-card)]">
              {confirm.sample.confirm}
            </span>
            <span className="inline-flex min-h-9 items-center rounded-[6px] border border-[var(--color-paper-edge)] px-4 text-[14px] font-semibold text-[var(--color-paper-ink-soft)]">
              {confirm.sample.edit}
            </span>
            <span className="inline-flex min-h-9 items-center rounded-[6px] border border-[var(--color-paper-edge)] px-4 text-[14px] font-semibold text-[var(--color-paper-ink-soft)]">
              {confirm.sample.later}
            </span>
          </div>

          <p className="mt-5 text-[16px] font-medium leading-[1.7] text-[var(--color-paper-ink)]">
            {confirm.sample.contract}
          </p>
          <p className={`mt-2 ${noteText}`}>확인을 누르기 전까지 예산 화면은 그대로예요.</p>
          <p className={`mt-2 ${noteText}`}>{confirm.sampleNote}</p>
        </div>

        <p className={`mt-8 max-w-[60ch] ${noteText}`}>{confirm.body}</p>
        <p className={`mt-2 max-w-[60ch] ${noteText}`}>{confirm.body2}</p>
        <p className={`mt-2 max-w-[60ch] ${noteText}`}>{confirm.note}</p>
      </div>
    </section>
  );
}
