import { redirect } from "next/navigation";

export const metadata = {
  title: "웨딩한방 커뮤니티 — 경험을 나누고 더 완벽한 결혼을 준비해요",
  description:
    "실제 후기, 견적 정보, 예산 팁, 동기부여 커뮤니티를 한 곳에서 확인하는 웨딩한방 커뮤니티.",
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
