"use client";

import { landingContent } from "./landingContent";
import { useLandingSession } from "./LandingSession";
import TrackedLandingLink from "./TrackedLandingLink";

/**
 * 첫 화면 오른쪽 위의 '로그인'.
 *
 * 아티팩트의 시작 화면에는 머리줄이 없다. 이미 계정이 있는 사람이 랜딩에서 바로 들어갈
 * 길 하나만 둔다. 사진 위 흰 글자는 분홍 보케 위에서 대비가 2:1 에도 못 미쳐서, 아티팩트가
 * 사진 위 버튼에 쓰는 반투명 흰 알약(공유 `Button` 의 glass)에 먹색 글자로 얹는다.
 *
 * 로그인했다고 **확인되면** 감춘다. 확인 전(서버가 그린 화면 포함)과 확인이 실패했을 때는
 * 보인다 — 랜딩에 오는 사람은 대부분 로그아웃 상태이고, 확인이 늦거나 막혀도 들어갈 길이
 * 남아야 한다. 이미 로그인한 사람이 눌러도 로그인 화면이 목적지로 돌려보낸다.
 */
export default function LandingAccountActions() {
  const status = useLandingSession();
  if (status === "signed_in") return null;

  const { logIn } = landingContent.account;
  return (
    <TrackedLandingLink
      href={logIn.href}
      source="landing_header"
      variant="glass"
      size="pill-34"
      weight="medium"
      className="px-[14px]"
    >
      {logIn.label}
    </TrackedLandingLink>
  );
}
