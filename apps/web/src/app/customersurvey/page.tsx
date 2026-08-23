import { notFound } from "next/navigation";

/**
 * The pre-MVP research survey collected contact details under an obsolete
 * questionnaire and consent scope. Keep the old URL closed until a new study,
 * disclosure, retention period, and consent flow are reviewed together.
 */
/**
 * ⚠️ 이 선언이 없으면 Next 가 이 페이지를 **미리 렌더**해 두고, 닫힌 페이지를
 * `200 OK` 로 서빙한다(2026-08-23 운영 실측: 본문은 404 화면인데 상태 코드는 200,
 * `X-Nextjs-Prerender: 1`). robots.txt 가 이 경로를 막지도 않으므로 검색엔진이
 * "찾을 수 없다"고 적힌 살아 있는 페이지를 색인하게 된다.
 *
 * 요청 시점에 notFound() 가 돌아야 진짜 404 가 나간다.
 */
export const dynamic = "force-dynamic";

export default function RetiredCustomerSurveyPage(): never {
  notFound();
}
