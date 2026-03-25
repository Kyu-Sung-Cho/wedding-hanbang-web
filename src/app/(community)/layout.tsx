import CommunityNav from "@/components/community/CommunityNav";
import Link from "next/link";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5]">
      <CommunityNav />

      {/* 메인 콘텐츠 */}
      <main className="flex-1">{children}</main>

      {/* 푸터 */}
      <footer className="border-t border-[#F5F2ED] bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <Link
              href="/"
              className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-lg font-medium text-[#1A1A1F]"
            >
              웨딩한방
            </Link>
            <div className="flex items-center gap-6 text-sm text-[#928980]">
              <Link href="/community" className="hover:text-[#1A1A1F] transition-colors">
                커뮤니티
              </Link>
              <Link href="/" className="hover:text-[#1A1A1F] transition-colors">
                서비스 소개
              </Link>
              <Link href="/login" className="hover:text-[#1A1A1F] transition-colors">
                로그인
              </Link>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-[#B5ADA3]">
            &copy; {new Date().getFullYear()} 웨딩한방. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
