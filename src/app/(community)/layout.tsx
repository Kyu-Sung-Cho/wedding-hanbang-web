import CommunityNav from "@/components/community/CommunityNav";
import Link from "next/link";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#F4F6F8]">
      <CommunityNav />

      {/* 메인 콘텐츠 */}
      <main className="flex-1">{children}</main>

      {/* 푸터 */}
      <footer className="border-t border-[#E5E7EB] bg-white">
        <div className="mx-auto max-w-5xl px-4 py-5">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <Link
              href="/"
              className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-sm font-medium text-[#1c1c1e]"
            >
              웨딩한방
            </Link>
            <div className="flex items-center gap-5 text-xs text-[#6B7280]">
              <Link href="/community" className="hover:text-[#1c1c1e] transition-colors">
                커뮤니티
              </Link>
              <Link href="/" className="hover:text-[#1c1c1e] transition-colors">
                서비스 소개
              </Link>
              <Link href="/login" className="hover:text-[#1c1c1e] transition-colors">
                로그인
              </Link>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-[#6B7280]">
            &copy; {new Date().getFullYear()} 웨딩한방. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
