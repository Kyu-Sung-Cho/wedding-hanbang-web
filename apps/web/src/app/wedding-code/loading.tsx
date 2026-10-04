import LoadStallHint from "@/components/wedding-code/LoadStallHint";

/**
 * 웨딩코드 경로의 로딩 화면. 루트 `app/loading.tsx` 와 같은 돌아가는 원을 그리고, 그 아래에 로딩 안내(12초 뒤 새로고침 줄과 자바스크립트 없음 줄)를 둔다.
 *
 * 왜 여기에 두나: 웨딩코드 화면은 `searchParams` 를 읽어 동적으로 그려지므로 본문이 Suspense 스트리밍 컨테이너(`div[hidden]`)로 들어오고,
 * 그 컨테이너는 자바스크립트가 풀어 주어야 보인다. 자바스크립트가 꺼진 브라우저에서는 본문 안의 `noscript` 줄도, 12초 줄도 보이지 않고
 * 로딩 원만 남는다. 로딩 화면(폴백)은 컨테이너 밖에 그려지므로 여기 둔 안내는 보인다. 웨딩코드 밖 화면에는 이 안내가 없다.
 */
export default function WeddingCodeLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FDFCFA] px-5">
      <div className="h-12 w-12 animate-spin rounded-full border-2 border-[#F0EFED] border-t-[#C4967E]" />
      <LoadStallHint className="max-w-xs text-center text-xs leading-relaxed text-[var(--hb-text-strong)]" />
    </div>
  );
}
