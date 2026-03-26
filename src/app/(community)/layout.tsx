import { Suspense } from "react";
import CommunityNav from "@/components/community/CommunityNav";
import { ToastContainer } from "@/components/community/Toast";
import Link from "next/link";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAF8]">
      <Suspense fallback={<div className="h-16 border-b border-[#F0EFED] bg-white" />}>
        <CommunityNav />
      </Suspense>
      <ToastContainer />

      {/* 메인 콘텐츠 */}
      <main className="flex-1">{children}</main>

      {/* 푸터 */}
      <footer className="border-t border-[#F0EFED] bg-white">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 xl:px-16 py-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <Link
              href="/"
              className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-base text-[#1A1A1F]"
            >
              웨딩한방
            </Link>
            <div className="flex items-center gap-8 text-base text-[#B5ADA3]">
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
          <p className="mt-5 text-center text-sm text-[#B5ADA3]">
            &copy; {new Date().getFullYear()} 웨딩한방. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
