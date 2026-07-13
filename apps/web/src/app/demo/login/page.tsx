import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import Logo from "@/components/ui/Logo";

export default async function DemoLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error === "rate_limited"
    ? "잠시 동안 예시 앱 시작 요청이 많았습니다. 잠시 후 다시 시도해 주세요."
    : error === "unavailable"
      ? "예시 앱을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."
      : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_52%,#f5f8f1_100%)] px-5 py-12">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -right-[8%] -top-[18%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#eef4f1,transparent)] blur-[100px] opacity-60" />
        <div className="absolute -bottom-[20%] -left-[10%] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,#f6efe5,transparent)] blur-[100px] opacity-55" />
      </div>

      <section
        className="relative z-10 w-full max-w-[480px]"
        aria-labelledby="demo-launcher-title"
      >
        <Link href="/demo" className="mb-8 flex justify-center" aria-label="예시 앱 소개로 돌아가기">
          <Logo size="md" />
        </Link>

        <div className="rounded-[28px] border border-black/[0.05] bg-white/85 p-7 shadow-[0_18px_60px_rgba(38,56,50,0.08)] backdrop-blur-xl sm:p-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#EEF4F1] px-3 py-1.5 text-[12px] font-medium text-[#36534E]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#36534E]" />
            계정 없는 예시 앱
          </div>

          <h1 id="demo-launcher-title" className="font-serif-kr text-[30px] font-light leading-[1.35] text-[#263832] sm:text-[34px]">
            내 정보 없이 먼저
            <br />
            웨딩한방을 둘러보세요
          </h1>
          <p className="mt-5 text-[14px] font-light leading-[1.8] text-[#635b51]">
            준비된 예시 커플의 일정·예산·상담 화면을 확인합니다. 입력한 내용은 실제 계정에 저장되지 않으며,
            예시 세션은 브라우저의 별도 체험 쿠키로만 유지됩니다.
          </p>

          <ul className="my-7 space-y-3 rounded-2xl bg-[#FBF8F2] p-5 text-[13px] leading-relaxed text-[#635b51]">
            <li>• 실제 이름·연락처·예식 정보를 입력할 필요가 없습니다.</li>
            <li>• 예시 데이터는 실제 사용자나 업체의 데이터가 아닙니다.</li>
            <li>• 계정 기능을 사용하려면 베타 계정을 별도로 만들어야 합니다.</li>
          </ul>

          {errorMessage && (
            <p className="mb-4 rounded-xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#9A554C]" role="alert">
              {errorMessage}
            </p>
          )}

          <form action="/api/demo/start" method="post">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#795252] to-[#946a6a] px-6 py-4 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(121,82,82,0.2)] transition-all hover:-translate-y-0.5"
            >
              <>
                <Play className="h-4 w-4" fill="currentColor" />
                예시 앱 체험 시작
              </>
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-3 border-t border-black/[0.06] pt-6 text-[13px] sm:flex-row sm:justify-between">
            <Link href="/login" className="text-[#635b51] underline-offset-4 hover:text-[#36534E] hover:underline">
              이미 계정이 있어요
            </Link>
            <Link href="/login?mode=signup" className="inline-flex items-center gap-1.5 font-medium text-[#36534E] hover:underline">
              베타 계정 만들기
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
