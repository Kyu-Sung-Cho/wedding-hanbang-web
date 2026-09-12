import { CalendarDays, ClipboardList, Wallet } from "lucide-react";
import AmoraAvatar from "@/components/ui/AmoraAvatar";

import { landingContent } from "./landingContent";
import { band, bodyText, eyebrowText, noteText, sectionTitle, shell, TitleLines } from "./notebook";

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
  const toolIcons = [Wallet, ClipboardList, CalendarDays];

  return (
    <section id="confirm" className={`${band} bg-[var(--color-ivory-50)]`} aria-labelledby="confirm-title">
      <div className={shell}>
        <p className="mb-[10px] lg:mb-3">
          <span className={eyebrowText}>
            {confirm.eyebrow}
          </span>
        </p>

        <h2 id="confirm-title" className={`${sectionTitle} max-w-[300px] lg:max-w-none`}>
          <TitleLines value={confirm.title} mobileLastWord />
        </h2>

        <p className={`mt-[14px] max-w-[600px] lg:mt-4 ${bodyText}`}>{confirm.lede}</p>

        <ul className="mt-[22px] grid gap-[10px] lg:mt-[46px] lg:grid-cols-3 lg:gap-[18px]">
          {confirm.tools.map((tool, index) => {
            const Icon = toolIcons[index] ?? ClipboardList;
            return (
              <li
                key={tool.title}
                className="flex items-center gap-[13px] rounded-[13px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-4 lg:block lg:rounded-[14px] lg:p-[22px]"
              >
                <span aria-hidden className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-ivory-warm)] text-[var(--color-rose-700)] lg:mb-[14px]">
                  <Icon className="size-5" strokeWidth={1.7} />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-[var(--color-paper-ink)] lg:text-[15px]">
                    {tool.title}
                  </p>
                  <p className={`mt-[3px] lg:mt-[6px] ${noteText}`}>{tool.body}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-[22px] max-w-[700px] rounded-[16px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-5 lg:mt-7 lg:rounded-[18px] lg:px-[30px] lg:py-7">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-semibold text-[var(--color-rose-700)] lg:text-[13px]">
            <span className="flex items-center gap-[7px] lg:gap-2">
              <AmoraAvatar sizeClassName="size-6" />
              <span>{confirm.sample.cardTitle}</span>
            </span>
            {/* 아직 아무 일도 일어나지 않았다는 표시. 시안에는 없지만 이 카드가
                이미 저장된 화면으로 읽히면 안 되기 때문에 넣는다. */}
            <span className="font-medium text-[var(--color-paper-ink-faint)]">
              {confirm.sample.saidLabel} · {confirm.sample.state}
            </span>
          </p>

          <ul className="mt-[14px] lg:mt-[18px]">
            {confirm.sample.rows.map((row, index) => (
              <li
                key={row.text}
                className={
                  index === 0
                    ? "flex items-start gap-[11px] py-[11px] lg:gap-[14px] lg:py-[13px]"
                    : "flex items-start gap-[11px] border-t border-[var(--color-paper-edge)] py-[11px] lg:gap-[14px] lg:py-[13px]"
                }
              >
                <span className={`inline-flex min-w-[46px] shrink-0 justify-center whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.5px] font-bold lg:min-w-[52px] lg:px-[10px] lg:py-1 lg:text-[11px] ${
                  index === 0
                    ? "bg-[var(--color-sage-pale)] text-[var(--color-paper-ink)]"
                    : index === 1
                      ? "bg-[var(--color-gold-light)] text-[var(--color-paper-ink-soft)]"
                      : "bg-[var(--color-rose-pale)] text-[var(--color-rose-700)]"
                }`}>
                  {row.chip}
                </span>
                <span className="text-[13.5px] leading-[1.6] text-[var(--color-paper-ink)] lg:text-[15px]">
                  {row.text}
                </span>
              </li>
            ))}
          </ul>

          {/* 진짜 버튼이 아니다. 눌리지 않는 그림이라는 걸 보조기기에도 알려야 한다. */}
          <div className="mt-4 grid grid-cols-2 gap-2 lg:mt-[18px] lg:flex lg:flex-wrap lg:gap-[9px]" aria-hidden="true">
            <span className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[var(--color-paper-ink)] px-4 text-[13px] font-semibold text-[var(--color-paper-card)] lg:rounded-[9px] lg:px-5 lg:text-[13.5px]">
              {confirm.sample.confirm}
            </span>
            <span className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--color-paper-edge)] px-4 text-[13px] font-semibold text-[var(--color-paper-ink-soft)] lg:rounded-[9px] lg:px-5 lg:text-[13.5px]">
              {confirm.sample.edit}
            </span>
            <span className="col-span-2 inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--color-paper-edge)] px-4 text-[13px] font-semibold text-[var(--color-paper-ink-soft)] lg:rounded-[9px] lg:px-5 lg:text-[13.5px]">
              {confirm.sample.later}
            </span>
          </div>

          <p className="mt-5 text-[14px] font-medium leading-[1.7] text-[var(--color-paper-ink)] lg:text-[15px]">
            {confirm.sample.contract}
          </p>
          <p className={`mt-2 ${noteText}`}>확인을 누르기 전까지 예산 화면은 그대로예요.</p>
          <p className={`mt-2 ${noteText}`}>{confirm.sampleNote}</p>
        </div>

        <p className={`mt-[22px] max-w-[700px] lg:mt-7 ${noteText}`}>{confirm.body}</p>
        <p className={`mt-2 max-w-[60ch] ${noteText}`}>{confirm.body2}</p>
        <p className={`mt-2 max-w-[60ch] ${noteText}`}>{confirm.note}</p>
      </div>
    </section>
  );
}
