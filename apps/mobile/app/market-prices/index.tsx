import { Redirect } from "expo-router";
import {
  buildMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";

const siteOrigin = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const priceExplorerUrl = buildMobileSiteUrl("/price/studio", siteOrigin);

// 업체별 공시 가격은 승인된 공개 뷰를 읽는 웹 탐색 화면을 단일 출처로 쓴다.
// 앱 안에 가격 사본을 두지 않아 공시 승격과 동시에 같은 근거를 보여준다.
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
