"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Plus, QrCode, BookOpen, Eye, MessageSquare } from "lucide-react";
import GuestbookQRModal from "@/components/community/GuestbookQRModal";
import type { Guestbook } from "@/types/community.types";

export default function MyGuestbooksPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Guestbook[]>([]);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // 인증 체크 먼저
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login?redirect=" + encodeURIComponent("/community/guestbook"));
        return;
      }
      try {
        const res = await fetch("/api/guestbook");
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?redirect=" + encodeURIComponent("/community/guestbook"));
            return;
          }
          throw new Error("load failed");
        }
        const data = await res.json();
        if (!cancelled) setItems(data.guestbooks ?? []);
      } catch {
        if (!cancelled) setError("방명록을 불러올 수 없습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-serif text-3xl font-medium text-[#1A1A1F]" style={{ fontFamily: "'Noto Serif KR', serif" }}>
          내 방명록
        </h1>
        <Link
          href="/community/guestbook/new"
          className="inline-flex items-center gap-2 bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-white rounded-xl py-3 px-5 font-medium shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all"
        >
          <Plus className="w-4 h-4" />새 방명록 만들기
        </Link>
      </div>

      {loading && (
        <div className="text-center py-20 text-[#B5ADA3]">불러오는 중...</div>
      )}

      {!loading && error && (
        <div className="bg-white border border-[#F0EFED] rounded-2xl p-8 text-center text-[#878680]">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="bg-white border border-[#F0EFED] rounded-2xl p-10 text-center">
          <BookOpen className="w-12 h-12 text-[#C4967E] mx-auto mb-4" />
          <h2 className="font-serif text-xl font-medium text-[#1A1A1F] mb-2">
            아직 만든 방명록이 없어요
          </h2>
          <p className="text-[#878680] mb-6 text-sm">
            종이 방명록 대신 디지털 방명록을 만들어보세요. QR 코드로 하객들이 쉽게 축하 메시지를 남길 수 있어요.
          </p>
          <Link
            href="/community/guestbook/new"
            className="inline-flex items-center gap-2 bg-gradient-to-br from-[#9d6f36] to-[#102a4d] text-white rounded-xl py-3 px-6 font-medium shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all"
          >
            <Plus className="w-4 h-4" />첫 방명록 만들기
          </Link>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {items.map((gb) => {
            const url = `${origin}/guestbook/${gb.slug}`;
            return (
              <div
                key={gb.id}
                className="bg-white border border-[#F0EFED] rounded-2xl p-6 flex flex-col"
              >
                <div className="mb-4">
                  <h2
                    className="font-serif text-2xl font-medium text-[#1A1A1F] leading-tight"
                    style={{ fontFamily: "'Noto Serif KR', serif" }}
                  >
                    {gb.bride_name} &amp; {gb.groom_name}
                  </h2>
                  <p className="text-sm text-[#878680] mt-1">{gb.wedding_date}</p>
                  {gb.venue && <p className="text-sm text-[#B5ADA3]">{gb.venue}</p>}
                </div>

                <div className="flex items-center gap-5 text-sm text-[#878680] mb-5">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4" />
                    {gb.message_count}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-4 h-4" />
                    {gb.view_count}
                  </span>
                </div>

                <div className="mt-auto flex gap-2">
                  <Link
                    href={`/guestbook/${gb.slug}`}
                    target="_blank"
                    className="flex-1 text-center bg-[#9d6f36] text-white rounded-xl py-2.5 px-4 text-sm font-medium hover:bg-[#102a4d] transition"
                  >
                    방명록 보기
                  </Link>
                  <button
                    type="button"
                    onClick={() => setQrUrl(url)}
                    className="inline-flex items-center gap-1.5 bg-white border border-[#F0EFED] text-[#1A1A1F] rounded-xl py-2.5 px-4 text-sm hover:border-[#C4967E] transition"
                  >
                    <QrCode className="w-4 h-4" />
                    QR 코드
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {qrUrl && <GuestbookQRModal url={qrUrl} onClose={() => setQrUrl(null)} />}
    </div>
  );
}
