import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, noteText, shell } from "./notebook";

/**
 * ⑦ 같은 시기에 준비하는 사람들 — **흰 카드 한 장.**
 *
 * 2026-09-03 시안: 왼쪽에 제목과 본문, 오른쪽에 분기방 목록. 눈썹이 없다 —
 * 카드가 지면에서 떠 있어 그 자체가 경계를 만든다.
 *
 * ## 분기 이름은 읽을 때 계산한다
 *
 * 시안은 "2026년 4분기 … 2027년 3분기" 를 픽셀로 박아 두었지만 그대로 옮기면 안 된다.
 * 고정 배열이던 시절, 9월에 온 사람이 **이미 끝난 결혼식의 방 이름 둘**을 읽고 정작
 * 자기가 갈 방은 못 봤다(2026-09-02 실측). `community.cohorts` 는 게터다.
 *
 * ## 태그는 링크가 아니다
 *
 * 행마다 붙는 "동기방" 은 상태 라벨이지 누를 수 있는 것이 아니다. 방으로 가는 길은
 * 카드 아래 링크 하나뿐이다 — 누를 수 있는 것을 여럿으로 보이게 하면 어디를 눌러야
 * 하는지가 흐려진다.
 */
export default function CommunitySection() {
  const { community } = landingContent;

  return (
    <section id="community" className={`${band} bg-[var(--color-paper-tint)] !pt-[34px]`} aria-labelledby="community-title">
      <div className={shell}>
        <div className="rounded-[16px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-5 lg:rounded-[18px] lg:px-[34px] lg:py-[30px]">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_230px] lg:items-center lg:gap-10">
            <div>
              <h2 id="community-title" className={`landing-display text-[21px] leading-[1.45] text-[var(--color-paper-ink)] lg:text-[23px]`}>
                {community.title}
              </h2>
              <p className={`mt-[10px] max-w-[64ch] ${noteText}`}>{community.body}</p>
              <p className={`mt-2 max-w-[52ch] ${noteText}`}>{community.note}</p>
              <p className="mt-5">
                <TrackedLandingLink
                  source="landing_community_cta"
                  href={community.cta.href}
                  className="landing-pen inline-flex min-h-11 items-center text-[16px] font-medium text-[var(--color-paper-ink)]"
                >
                  {community.cta.label}
                </TrackedLandingLink>
              </p>
            </div>

            <ul className="grid gap-[7px]">
              {community.cohorts.map((cohort) => (
                <li
                  key={cohort}
                  className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-paper-edge)] px-[14px] py-[11px]"
                >
                  <span className="text-[13px] font-normal text-[var(--color-paper-ink-soft)]">
                    {cohort}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-[var(--color-paper-ink-faint)]">
                    {community.cohortTag}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
