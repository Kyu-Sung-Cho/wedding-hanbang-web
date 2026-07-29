import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 — 공시된 가격·위약금 원문과 AI 웨딩 플래너 아모라",
  description:
    "업체가 공시한 스드메·예식장 기본가와 추가금, 취소 위약금 규정을 원문 그대로 봅니다. "
    + "예산·일정·업체 준비는 AI 아모라가 같이 잡습니다. 요약도, 어디가 낫다는 판정도 하지 않습니다.",
};

// 메인 도메인은 서비스를 설명하는 랜딩(/landing)으로 보낸다. 앱(커뮤니티 피드)은
// 랜딩 안의 링크로 들어간다 — 자세한 이유는 next.config.ts의 같은 리다이렉트 주석.
// 이 페이지는 엣지 리다이렉트가 걸리지 않는 환경을 위한 폴백이라 목적지를 맞춰 둔다.
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const params = new URLSearchParams();

  Object.entries(resolvedSearchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined) params.append(key, item);
      });
    } else if (value !== undefined) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  redirect(query ? `/landing?${query}` : "/landing");
}
