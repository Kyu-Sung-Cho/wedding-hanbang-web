import Link from "next/link";
import { Info } from "lucide-react";

// 체험 세션은 "김지은님"의 예산·일정·동기방 인원까지 모두 채워진 화면을 보여준다.
// 라벨이 없으면 처음 온 사람은 남의 계정으로 들어온 줄 알거나, 샘플 수치를
// 실제 서비스 활동으로 오해한다(2026-07-25 라이브 확인: 본문에 체험 고지 0회).
export default function DemoModeBanner() {
  return (
    <div
      role="status"
      className="border-b border-[#B89785]/40 bg-[#F5ECE4] px-4 py-3 text-[#5F4340] sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center gap-x-3 gap-y-1.5">
        <Info aria-hidden="true" className="size-4 shrink-0" />
        <p className="text-[13px] font-bold">체험 모드예요</p>
        <p className="min-w-0 flex-1 text-[13px] leading-6">
          화면의 이름·예산·일정·동기방 인원은 기능을 보여주기 위한 <strong className="font-bold">샘플</strong>이고,
          실제 이용 현황이 아니에요. 여기서 바꾼 내용은 저장되지 않아요.
        </p>
        <Link
          href="/login?mode=signup"
          prefetch={false}
          className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-[#36534E] px-4 text-[13px] font-bold text-white hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
        >
          내 정보로 시작하기
        </Link>
      </div>
    </div>
  );
}
