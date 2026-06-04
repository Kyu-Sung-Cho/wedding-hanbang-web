import { Suspense } from "react";
import Link from "next/link";
import { Instagram, Mail, MessageCircle, Play, ShieldCheck } from "lucide-react";
import CommunityNav from "@/components/community/CommunityNav";
import CommunityAuthInitializer from "@/components/community/CommunityAuthInitializer";
import CommunityAmoraLauncher from "@/components/community/CommunityAmoraLauncher";
import { ToastContainer } from "@/components/community/Toast";
import Logo from "@/components/ui/Logo";
import { weddingPath } from "@/lib/weddingPaths";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="hanbang-community-theme flex min-h-screen flex-col bg-[#fffdf7]">
      <CommunityAuthInitializer />
      <Suspense fallback={<div className="h-[76px] bg-[#fffdf7]" />}>
        <CommunityNav />
      </Suspense>
      <ToastContainer />

      <main className="flex-1">{children}</main>

      <CommunityFooter />
      <CommunityAmoraLauncher />
    </div>
  );
}

function FooterBrand() {
  return (
    <Link href={weddingPath()} className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
      <Logo size="md" variant="white" />
    </Link>
  );
}

function CommunityFooter() {
  return (
    <footer className="bg-[linear-gradient(135deg,#183832_0%,#2f5f55_58%,#12302b_100%)] text-white">
      <div className="mx-auto grid w-full max-w-[1320px] gap-9 px-4 py-8 sm:px-6 md:grid-cols-[1.2fr_0.78fr_0.78fr_0.86fr_0.9fr_1.35fr] lg:px-8">
        <div>
          <FooterBrand />
          <p className="mt-3 text-[13px] font-medium text-white/70">
            AI가 함께하는 가장 든든한 결혼 준비
          </p>
          <div className="mt-5 flex gap-3">
            {[
              { icon: Instagram, label: "Instagram" },
              { icon: Play, label: "YouTube" },
              { icon: MessageCircle, label: "Kakao" },
            ].map((item) => (
              <Link
                key={item.label}
                href={weddingPath()}
                aria-label={item.label}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/80 transition-colors hover:border-[#d8c79a] hover:text-[#f2e8c8]"
              >
                <item.icon className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </div>

        <FooterColumn
          title="둘러보기"
          items={[
            { label: "후기·질문", href: weddingPath("/community#community-feed") },
            { label: "가격·후기", href: weddingPath("/community?category=tour_review&search=견적&feed=all#community-feed") },
            { label: "동기방", href: weddingPath("/community/cohort") },
            { label: "글쓰기", href: weddingPath("/community/post/write") },
            { label: "북마크", href: weddingPath("/community/my/bookmarks") },
          ]}
        />
        <FooterColumn
          title="준비 도구"
          items={[
            { label: "웨딩 라운지", href: weddingPath("/lounge") },
            { label: "아모라 상담", href: weddingPath("/chat") },
            { label: "예산", href: weddingPath("/budget") },
            { label: "일정", href: weddingPath("/schedule") },
          ]}
        />
        <FooterColumn
          title="정책"
          items={[
            { label: "이용약관", href: "/terms" },
            { label: "개인정보처리방침", href: "/privacy" },
            { label: "AI 정책", href: "/ai-policy" },
            { label: "제휴 / 제보문의", href: "/business" },
          ]}
        />

        <div>
          <h3 className="mb-3 text-[14px] font-semibold text-white">연락</h3>
          <div className="space-y-1 text-[13px] font-medium text-white/70">
            <p>contact@wedding-hanbang.kr</p>
            <p>02-1234-5678</p>
            <p>평일 10:00 - 18:00</p>
            <p>(점심 12:00 - 13:00)</p>
          </div>
        </div>

        <div className="rounded-[18px] border border-white/16 bg-white/[0.055] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#d8c79a]" />
            <h3 className="text-[14px] font-semibold text-white">안전한 AI 안내</h3>
          </div>
          <p className="text-[12px] font-medium leading-[1.7] text-white/65">
            개인정보와 AI 생성 안내를 투명하게 고지하고 안전한 결혼 준비를 돕습니다.
          </p>
          <Link
            href={weddingPath("/lounge")}
            className="mt-4 inline-flex items-center rounded-full border border-[#d8c79a]/70 px-4 py-2 text-[12px] font-semibold text-[#f2e8c8] transition-colors hover:bg-white/10"
          >
            웨딩 라운지로 이동
            <Mail className="ml-2 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1320px] border-t border-white/10 px-4 py-4 text-center text-[12px] text-white/55 sm:px-6 lg:px-8">
        © 2026 Wedding Hanbang. All rights reserved.
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <h3 className="mb-3 text-[14px] font-semibold text-white">{title}</h3>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="text-[13px] font-medium text-white/65 hover:text-[#f2e8c8]">
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
