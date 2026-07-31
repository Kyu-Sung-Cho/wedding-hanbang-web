import { Redirect } from "expo-router";
import {
  buildMobileSiteUrl,
  resolveMobileSiteOrigin,
} from "@/lib/siteUrl.mjs";

const siteOrigin = resolveMobileSiteOrigin(
  process.env.EXPO_PUBLIC_SITE_URL,
  { isDevelopment: __DEV__ },
);
const quoteCheckUrl = buildMobileSiteUrl(
  "/wedding/community/quote-check",
  siteOrigin,
);

// 견적 체크는 웹과 같은 비저장 계산 경로를 사용한다. 앱에 별도 사본을 두지 않아
// 세 상태(포함/이용 안 함/확인 필요)와 개인정보 경계가 웹과 어긋나지 않게 한다.
export default function QuoteCheckScreen() {
  return (
    <Redirect
      href={{
        pathname: "/webview",
        params: { url: quoteCheckUrl },
      }}
    />
  );
}
