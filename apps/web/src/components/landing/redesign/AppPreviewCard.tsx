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
 * ## 시안에서 뺀 것 둘
 *
 * 창틀 점 셋과 브리핑 밑의 진행 막대를 뺐다. 둘 다 **아무 값도 지고 있지 않은 장식**이고,
 * 이 저장소는 그런 장식을 금지한다(`landingDesignSystem.test.ts` 의 "뜻 없는 eyebrow
 * 장식"). 카드가 앱 화면으로 읽히는 것은 위쪽 띠와 그 안의 이름·상태 배지가 만든다.
 *
 * ## 스크린리더
 *
 * 라벨(`note`)을 `figcaption` 으로 묶어 **figure 의 이름**으로 쓴다 — 목록에서
 * "예산 상한부터…" 만 들리면 실제 데이터로 읽힌다.
 */
export default function AppPreviewCard() {
  const { preview } = landingContent.hero;

  return (
    <figure className="m-0 overflow-hidden rounded-[12px] bg-[var(--color-paper-card)] shadow-raised">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-paper-edge)] bg-[var(--color-paper-tint)] px-5 py-3">
        <p className="text-[14px] font-medium text-[var(--color-paper-ink-soft)]">
          {preview.appName}
        </p>
        <p className="rounded-full bg-[var(--color-paper-card)] px-3 py-1 text-[12px] font-semibold text-[var(--color-paper-ink-faint)]">
          {preview.badge}
        </p>
      </div>

      <div className="p-5 sm:p-6">
        <div className="rounded-[8px] bg-[var(--color-paper-ink)] px-5 py-5">
          <p className="text-[12px] font-medium text-[var(--color-paper-on-ink-faint)]">
            {preview.dLabel}
          </p>
          <p className="mt-1 text-[30px] font-semibold leading-[1.2] text-[var(--color-paper-on-ink)]">
            {preview.dValue}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          {preview.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-[8px] border border-[var(--color-paper-edge)] px-3 py-3"
            >
              <p className="text-[12px] text-[var(--color-paper-ink-faint)]">{stat.label}</p>
              <p className="mt-1 text-[18px] font-semibold text-[var(--color-paper-ink)]">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-[8px] border border-[var(--color-paper-edge)] px-4 py-4">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-paper-ink-faint)]">
            <span aria-hidden>☆</span>
            <span>{preview.briefLabel}</span>
          </p>
          <p className="mt-2 text-[14px] font-medium leading-[1.6] text-[var(--color-paper-ink)]">
            {preview.brief}
          </p>
        </div>

        <figcaption className="mt-4 text-[12px] leading-[1.6] text-[var(--color-paper-ink-faint)]">
          {preview.note}
        </figcaption>
      </div>
    </figure>
  );
}
