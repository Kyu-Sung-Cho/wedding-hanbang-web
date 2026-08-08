export interface DashboardCompanionCopy {
  loungeLabel: string;
  statusHeading: string;
  description: string;
  amoraCtaLabel: string;
  amoraPrompt: string;
}

const SOLO_COPY: DashboardCompanionCopy = {
  loungeLabel: "나의 웨딩 라운지",
  statusHeading: "혼자 준비 중",
  description:
    "내 일정과 예산, 할 일을 한곳에서 챙겨요. 파트너 초대는 나중에 해도 괜찮아요.",
  amoraCtaLabel: "아모라에게 다음 할 일 묻기",
  amoraPrompt:
    "지금 내 결혼 준비 상황을 보고, 오늘 혼자 할 수 있는 다음 행동 한 가지만 알려줘.",
};

const COUPLE_COPY: DashboardCompanionCopy = {
  loungeLabel: "우리 둘의 웨딩 라운지",
  statusHeading: "함께 준비 중",
  description: "같은 일정과 예산, 할 일을 보면서 우리 속도에 맞게 준비해요.",
  amoraCtaLabel: "아모라와 같이 점검하기",
  amoraPrompt:
    "지금 우리 결혼 준비 상황을 함께 점검해줘. 같이 확인할 한 가지와 두 사람이 나눠 할 수 있는 일 한 가지를 제안해줘. 담당자는 정하지 말고 우리가 고르게 해줘.",
};

export const JOINED_PLAN_REVIEW_PROMPT =
  "방금 파트너와 연결됐어. 지금 함께 보게 된 결혼식 날짜, 장소, 예산, 준비 진행 중 둘이 먼저 확인할 부분을 짚어줘. 계획을 변경하거나 담당자를 정하지 말고, 같이 확인할 내용만 알려줘.";

const JOINED_MARKER_CHANGE_EVENT = "hanbang:joined-dashboard-marker-change";

export function getDashboardCompanionCopy(
  hasPartner: boolean,
): DashboardCompanionCopy {
  return hasPartner ? COUPLE_COPY : SOLO_COPY;
}

export function buildJoinedDashboardRedirect(): string {
  return "/wedding/lounge?joined=1";
}

export function hasJoinedDashboardMarker(search: string): boolean {
  return new URLSearchParams(search).get("joined") === "1";
}

export function getJoinedDashboardMarkerSnapshot(): boolean {
  return typeof window !== "undefined"
    && hasJoinedDashboardMarker(window.location.search);
}

export function subscribeJoinedDashboardMarker(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(JOINED_MARKER_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(JOINED_MARKER_CHANGE_EVENT, onStoreChange);
  };
}

export function notifyJoinedDashboardMarkerChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(JOINED_MARKER_CHANGE_EVENT));
}

export function removeJoinedDashboardMarker(
  pathname: string,
  search: string,
  hash = "",
): string {
  const params = new URLSearchParams(search);
  params.delete("joined");
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash}`;
}
