import { Suspense } from "react";
import Link from "next/link";
import { Instagram, Mail, MessageCircle, Play, ShieldCheck } from "lucide-react";
import CommunityNav from "@/components/community/CommunityNav";
import CommunityAuthInitializer from "@/components/community/CommunityAuthInitializer";
import { ToastContainer } from "@/components/community/Toast";
import Logo from "@/components/ui/Logo";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="hanbang-community-theme flex min-h-screen flex-col bg-[#fbf8f2]">
      <CommunityAuthInitializer />
      <Suspense fallback={<div className="h-[76px] bg-[#fbf8f2]" />}>
        <CommunityNav />
      </Suspense>
      <ToastContainer />

      <main className="flex-1">{children}</main>

      <CommunityFooter />
    </div>
  );
}

function FooterBrand() {
  return (
    <Link href="/community" className="inline-flex items-center whitespace-nowrap">
      <Logo size="md" variant="white" />
    </Link>
  );
}

function CommunityFooter() {
  return (
    <footer className="bg-[linear-gradient(135deg,#263832_0%,#082342_62%,#041425_100%)] text-white">
      <div className="mx-auto grid w-[calc(100%_-_48px)] max-w-[1300px] gap-9 py-8 md:grid-cols-[1.2fr_0.78fr_0.78fr_0.86fr_0.9fr_1.35fr]">
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
                href="/community"
                aria-label={item.label}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/80 transition-colors hover:border-[#36534E] hover:text-[#36534E]"
              >
                <item.icon className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </div>

        <FooterColumn
          title="둘러보기"
          items={[
            { label: "후기·질문", href: "/community#community-feed" },
            { label: "견적 체크", href: "/community/quote-check" },
            { label: "동기방", href: "/community/cohort" },
            { label: "글쓰기", href: "/community/post/write" },
            { label: "북마크", href: "/community/my/bookmarks" },
          ]}
        />
        <FooterColumn
          title="준비 도구"
          items={[
            { label: "준비실", href: "/dashboard" },
            { label: "아모라 상담", href: "/chat" },
            { label: "예산", href: "/budget" },
            { label: "일정", href: "/schedule" },
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

        <div className="rounded-[18px] border border-white/15 bg-white/[0.04] p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#B89785]" />
            <h3 className="text-[14px] font-semibold text-white">안전한 AI 안내</h3>
          </div>
          <p className="text-[12px] font-medium leading-[1.7] text-white/65">
            개인정보와 AI 생성 안내를 투명하게 고지하고 안전한 결혼 준비를 돕습니다.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center rounded-full border border-[#36534E]/70 px-4 py-2 text-[12px] font-semibold text-[#ffffff] transition-colors hover:bg-[#36534E]/10"
          >
            준비실로 이동
            <Mail className="ml-2 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div className="mx-auto w-[calc(100%_-_48px)] max-w-[1300px] border-t border-white/10 py-4 text-center text-[12px] text-white/55">
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
          <Link key={item.label} href={item.href} className="text-[13px] font-medium text-white/65 hover:text-[#ffffff]">
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
