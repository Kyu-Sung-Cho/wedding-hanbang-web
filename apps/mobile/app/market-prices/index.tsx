import { Redirect } from "expo-router";
import {
  buildMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";

const siteOrigin = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const priceExplorerUrl = buildMobileSiteUrl("/price", siteOrigin);

// 업체별 공시 가격은 승인된 공개 뷰를 읽는 웹 탐색 화면을 단일 출처로 쓴다.
// 앱 안에 가격 사본을 두지 않아 공시 승격과 동시에 같은 근거를 보여준다.
//
// 카테고리 화면으로 바로 들어가면 허브의 위약금 안내를 건너뛴다 —
// h1("공시 가격과 위약금, 업체가 쓴 문장 그대로")과 대행사별 차이 예시,
// "업체 상세의 '계약 전 확인'에서 비교하세요"가 전부 허브에 있다(`c019c68c`).
// 앱 메뉴가 "공시가·위약금"이라고 약속하므로 도착 화면도 그걸 말해야 한다.
export default function MarketPricesScreen() {
  return (
    <Redirect
      href={{
        pathname: "/webview",
        params: { url: priceExplorerUrl },
      }}
    />
  );
}
