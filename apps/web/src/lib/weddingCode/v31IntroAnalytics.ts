import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { captureWeddingCodeEvent } from "@/lib/analytics";

/**
 * v3.1 소개 화면 조회(wedding_code_intro_viewed)를 한 페이지 로드에 한 번만 보낸다.
 *
 * 왜 따로 두나: 답이 든 링크(`#v=…&a=…`)는 서버가 # 뒤를 보지 못해, 서버 화면과 하이드레이션 첫 그림은 링크 문맥이 없는 기본 소개다.
 * 입구(WeddingCodeEntryClient)가 하이드레이션 뒤에 # 뒤를 읽고 화면을 다시 만들면 같은 사람이 소개를 두 번 연 것으로 집계됐다
 * (has_partner_link=false 한 번, true 한 번). 그래서 (1) 보내는 순간 주소의 # 뒤에서 상대 링크 표지를 직접 읽어 첫 전송부터 맞는 값을 쓰고,
 * (2) 같은 페이지 로드에서는 한 번만 보낸다. 속성의 뜻은 그대로다: has_partner_link 는 「상대가 보낸 링크로 들어왔는지」다.
 * 주소의 답이나 해시 자체는 읽기만 하고 이벤트에 싣지 않는다(허용 속성은 lib/analyticsPrivacy.ts 의 표 그대로다).
 */
let sentThisPageLoad = false;

/** 시험이 페이지 로드를 새로 시작한 것처럼 되돌린다. */
export function resetV31IntroViewedForTest() {
  sentThisPageLoad = false;
}

/** 주소의 # 뒤가 v3.1 의 상대 링크(`a=` 가 있고 `v=` 가 없거나 v3.1)이면 true, 다른 판의 링크이면 "other", 아니면 false. */
export function readV31PartnerLinkFromHash(hash: string): boolean | "other" {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const version = params.get("v");
  if (version !== null && version !== WEDDING_CODE_V31_VERSION) return params.has("a") ? "other" : false;
  return Boolean(params.get("a"));
}

export function sendV31IntroViewedOnce({ sceneTotal, hasPartnerLink, placement }: { sceneTotal: number; hasPartnerLink: boolean; placement: string }) {
  if (sentThisPageLoad || typeof window === "undefined") return;
  const fromHash = readV31PartnerLinkFromHash(window.location.hash);
  // 다른 판(v4 등)의 링크로 들어온 사람의 첫 그림은 이 소개의 조회가 아니다. 보내지도 않고 보낸 것으로 치지도 않는다.
  if (fromHash === "other") return;
  sentThisPageLoad = true;
  captureWeddingCodeEvent("wedding_code_intro_viewed", {
    version: WEDDING_CODE_V31_VERSION, scene_total: sceneTotal, has_partner_link: hasPartnerLink || fromHash, placement,
  });
}
