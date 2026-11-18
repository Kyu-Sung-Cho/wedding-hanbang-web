import Link from "next/link";
import type { ComponentType } from "react";
import { HOME_COPY, type InvitationRouteKey } from "@hanbang/shared/invitation";

import { NavAmoraIcon, NavInvitationIcon, NavJourneyIcon, NavScheduleIcon } from "./InvitationIcons";
import { INVITATION_FOCUS_RING, cx, type InvitationRouteResolver } from "./invitationScreen";

export type InvitationTabKey = "home" | "chat" | "journey" | "schedule";

const TABS: readonly {
  key: InvitationTabKey;
  route: InvitationRouteKey;
  label: string;
  Icon: ComponentType;
}[] = [
  { key: "home", route: "home", label: HOME_COPY.nav.home, Icon: NavInvitationIcon },
  { key: "chat", route: "chat", label: HOME_COPY.nav.chat, Icon: NavAmoraIcon },
  { key: "journey", route: "journey", label: HOME_COPY.nav.journey, Icon: NavJourneyIcon },
  // 아티팩트의 "일정" 칸은 답장과 상담 확정 화면을 연다.
  { key: "schedule", route: "status", label: HOME_COPY.nav.schedule, Icon: NavScheduleIcon },
];

/**
 * 떠 있는 하단 메뉴(`Home.dc` 의 nav). 높이 64, 반경 32, 흰 88% 에 흐림 20.
 *
 * 아티팩트처럼 화면 틀(홈 뿌리) 바닥에서 22px 위, 좌우 16px 에 놓는다. 홈 뿌리가 창 높이를
 * 채우는 세로 단이라 창 바닥에 붙는다. 아이폰 홈 막대가 있으면 그 높이만큼 더 띄운다.
 */
export default function InvitationTabBar({
  active,
  resolveRoute,
  hrefs,
  tutorialTargets,
  className,
}: {
  active: InvitationTabKey | null;
  resolveRoute: InvitationRouteResolver;
  /**
   * 칸마다 주소를 따로 줄 때. 실제 커플의 "일정" 칸은 상담 확정이 아니라 일정 화면을 연다.
   * 없으면 아티팩트 흐름 그대로 화면 이름으로 간다.
   */
  hrefs?: Partial<Record<InvitationTabKey, string>>;
  /** 실제 커플의 첫 실행 안내가 가리킬 칸(`data-tutorial-target`). 예시 화면은 넘기지 않는다. */
  tutorialTargets?: Partial<Record<InvitationTabKey, string>>;
  className?: string;
}) {
  return (
    <nav
      aria-label={HOME_COPY.nav.label}
      className={cx(
        "absolute inset-x-4 bottom-[calc(22px_+_env(safe-area-inset-bottom))] z-20 flex h-16",
        "items-center justify-around rounded-[32px] bg-[rgba(255,255,255,0.88)] px-2 backdrop-blur-[20px]",
        "shadow-[0_6px_24px_rgba(30,28,34,0.10),inset_0_0_0_1px_rgba(30,28,34,0.05)]",
        className,
      )}
    >
      {TABS.map(({ key, route, label, Icon }) => {
        const current = key === active;
        return (
          <Link
            key={key}
            href={hrefs?.[key] ?? resolveRoute(route)}
            aria-label={label}
            aria-current={current ? "page" : undefined}
            data-tab={key}
            data-tutorial-target={tutorialTargets?.[key]}
            className={cx(
              "flex h-12 w-[52px] items-center justify-center",
              current ? "rounded-[24px] bg-inv-ink text-inv-white" : "text-inv-body",
              INVITATION_FOCUS_RING,
            )}
          >
            <Icon />
          </Link>
        );
      })}
    </nav>
  );
}
