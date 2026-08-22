import type { Metadata } from "next";

import InviteLandingClient from "./InviteLandingClient";

/**
 * 초대 링크가 착지하는 곳 — 파트너가 QR을 찍거나 링크를 눌렀을 때 처음 보는 화면.
 *
 * ## 왜 코드가 주소창의 `#` 뒤에 있나
 *
 * 이 코드는 커플 공간에 들어오는 열쇠다. 경로나 쿼리에 넣으면 서버 접근 로그, 리퍼러
 * 헤더, 분석 도구에 그대로 남는다. `#` 뒤는 브라우저가 서버로 보내지 않으므로,
 * 링크가 아무리 여러 번 눌려도 코드는 서버 기록에 쌓이지 않는다.
 *
 * 그래서 이 페이지는 서버에서 코드를 알 수 없다. 화면을 그리는 일은 전부 클라이언트가 한다.
 *
 * ## 왜 "누가 초대했는지"를 보여주지 않나
 *
 * 코드만으로 상대 이름을 조회해 보여주면, 코드를 주운 사람도 그 사람의 이름을 알게 된다.
 * 초대를 받은 본인은 누가 보냈는지 이미 알고 있다 — 메신저로 받았으니까. 여기서 이름을
 * 확인시켜 줄 이유가 없다.
 */
export const metadata: Metadata = {
  title: "초대 코드로 시작하기 | 웨딩한방",
  description: "파트너가 보낸 초대 코드로 웨딩한방에서 함께 결혼을 준비해요.",
  // 이 주소는 검색에 뜨면 안 된다. 코드는 `#` 뒤라 색인되지 않지만, 경로 자체가
  // 검색 결과에 노출되면 초대와 무관한 사람이 흘러들어온다.
  robots: { index: false, follow: false },
};

export default function InviteLandingPage() {
  return <InviteLandingClient />;
}
