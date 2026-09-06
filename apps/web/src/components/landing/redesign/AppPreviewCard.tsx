import { landingContent } from "./landingContent";

/**
 * 히어로 오른쪽의 앱 화면 미리보기.
 *
 * 2026-09-03 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)의 오른쪽 카드다. 첫 화면이
 * 글자로만 설명하던 것을 **한 장면으로** 보여 준다 — 라운지에 들어가면 무엇이 보이는지.
 *
 * ## 연출된 화면이라 라벨이 카드 **안**에 있다
 *
 * 숫자(34% · 9건)도 브리핑 문장도 샘플이다. 이 저장소는 연출한 자리마다 라벨을 다는
 * 계약을 갖고 있고(아모라 카드·확인 카드가 같은 방식), 바깥 작은 글씨로 빼면 카드만
 * 캡처돼 돌아다닐 때 라벨이 떨어져 나간다.
 *
 * 데스크톱 HTML 시안의 창틀 점은 장식으로 표시하고 보조기기에서 숨긴다.
 * 모바일은 창틀 없이 흰 카드다. 실제 진행량이 없는 브리핑 막대는 표시하지 않는다.
 *
 * ## 스크린리더
 *
 * 라벨(`note`)을 `figcaption` 으로 묶어 **figure 의 이름**으로 쓴다 — 목록에서
 * "예산 상한부터…" 만 들리면 실제 데이터로 읽힌다.
 */
export default function AppPreviewCard() {
  const { preview } = landingContent.hero;

  return (
    <figure className="m-0 overflow-hidden rounded-[16px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-4 shadow-raised lg:bg-[var(--color-paper-sheet)] lg:p-0">
      <div aria-hidden="true" className="hidden gap-[7px] border-b border-[var(--color-paper-edge)] bg-[var(--color-paper-tint)] px-[18px] py-[14px] lg:flex">
        <span className="size-[10px] rounded-full bg-[var(--color-paper-edge)]" />
        <span className="size-[10px] rounded-full bg-[var(--color-paper-edge)]" />
        <span className="size-[10px] rounded-full bg-[var(--color-paper-edge)]" />
      </div>
      <div className="flex items-center justify-between gap-3 pb-3 lg:px-[22px] lg:pt-[22px] lg:pb-[14px]">
        <p className="text-[12px] font-normal text-[var(--color-paper-ink-faint)] lg:text-[13px]">
          {preview.appName}
        </p>
        <p className="rounded-full bg-[var(--color-sage-pale)]/60 px-[9px] py-1 text-[10.5px] font-semibold text-[var(--color-noir-900)] lg:text-[11px]">
          {preview.badge}
        </p>
      </div>

      <div className="lg:px-[22px] lg:pb-[22px]">
        <div className="rounded-[12px] bg-[var(--color-paper-ink)] px-[17px] py-[15px] lg:rounded-[14px] lg:px-5 lg:py-[18px]">
          <p className="text-[12px] font-medium text-[var(--color-paper-on-ink-faint)]">
            {preview.dLabel}
          </p>
          <p className="landing-display mt-1 text-[25px] leading-[1.4] text-[var(--color-paper-on-ink)] lg:text-[28px]">
            {preview.dValue}
          </p>
        </div>

        <div className="mt-[10px] grid grid-cols-3 gap-[7px] lg:mt-3 lg:gap-[9px]">
          {preview.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-[9px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)] p-[9px] lg:rounded-[10px] lg:bg-[var(--color-paper-card)] lg:p-[11px]"
            >
              <p className="text-[11px] text-[var(--color-paper-ink-faint)]">{stat.label}</p>
              <p className="mt-1 text-[14px] font-semibold text-[var(--color-paper-ink)] lg:text-[16px]">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-[10px] rounded-[11px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)] p-[13px] lg:mt-3 lg:rounded-[12px] lg:bg-[var(--color-paper-card)] lg:p-[15px]">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-paper-ink-faint)]">
            <span aria-hidden>☆</span>
            <span>{preview.briefLabel}</span>
          </p>
          <p className="mt-2 text-[12.5px] font-semibold leading-[1.5] text-[var(--color-paper-ink)] lg:text-[14px]">
            {preview.brief}
          </p>
        </div>

        <figcaption className="mt-[14px] text-[11px] leading-[1.6] text-[var(--color-paper-ink-faint)] lg:text-[12px]">
          {preview.note}
        </figcaption>
      </div>
    </figure>
  );
}
