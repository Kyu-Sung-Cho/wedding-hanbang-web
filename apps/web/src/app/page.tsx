import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 — 스드메 공시가·위약금 원문과 예비부부 커뮤니티",
  description:
    "업체가 공시한 기본가·추가금과 취소 위약금 규정 원문을 그대로 확인하고, "
    + "먼저 겪은 예비부부들의 글도 함께 보세요. 요약도, 어디가 낫다는 판정도 하지 않습니다.",
};

// 메인 도메인은 웨딩한방 시작점(/wedding)으로 보낸다.
// 마케팅 랜딩은 /landing으로 보존.
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
  redirect(query ? `/wedding?${query}` : "/wedding");
}
