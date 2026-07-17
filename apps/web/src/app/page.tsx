import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 커뮤니티 — 결혼 준비 경험과 질문을 나눠요",
  description:
    "이용자가 남긴 경험 글, 견적 질문과 준비 이야기를 한 곳에서 확인하는 웨딩한방 커뮤니티.",
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
