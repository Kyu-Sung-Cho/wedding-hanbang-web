import Link from "next/link";

export default function RetiredQuickReviewPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
      <h1 className="font-serif-kr text-2xl font-medium text-[#263832]">
        빠른 후기는 제공하지 않아요
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[#635b51]">
        업체 별점과 짧은 평가는 사실 확인 없이 신뢰 신호로 오해될 수 있어 종료했습니다.
        경험을 공유하려면 광고·협찬 여부와 구체적인 상황을 적을 수 있는 기본 글쓰기를 이용해 주세요.
      </p>
      <Link
        href="/community/post/write"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white"
      >
        기본 글쓰기로 이동
      </Link>
    </main>
  );
}
