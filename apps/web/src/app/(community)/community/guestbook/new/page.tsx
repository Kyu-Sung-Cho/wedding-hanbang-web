"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Loader2 } from "lucide-react";
import { useToast } from "@/components/community/Toast";

export default function NewGuestbookPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // 인증 체크 — 미로그인이면 로그인 페이지로
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace(
          "/login?redirect=" + encodeURIComponent("/community/guestbook/new")
        );
        return;
      }
      setAuthChecked(true);
    });
  }, [router]);

  const [form, setForm] = useState({
    bride_name: "",
    groom_name: "",
    wedding_date: "",
    venue: "",
    our_story: "",
    proposal_story: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!form.bride_name || !form.groom_name || !form.wedding_date) {
      toast.error("신부, 신랑 이름과 결혼 날짜를 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "생성에 실패했습니다.");
      }
      toast.success("방명록이 만들어졌어요.");
      router.push(`/guestbook/${data.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#36534E] focus:outline-none text-base";

  if (!authChecked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <h1
        className="font-serif text-3xl font-medium text-[#1A1A1F] mb-2"
        style={{ fontFamily: "'Noto Serif KR', serif" }}
      >
        새 방명록 만들기
      </h1>
      <p className="text-[#878680] mb-8 text-sm">
        디지털 방명록을 만들고 하객들에게 QR 코드를 공유하세요.
      </p>

      <form onSubmit={handleSubmit} className="bg-white border border-[#F0EFED] rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
              신부 이름 <span className="text-[#36534E]">*</span>
            </label>
            <input
              type="text"
              value={form.bride_name}
              onChange={(e) => update("bride_name", e.target.value)}
              className={inputCls}
              placeholder="민지"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
              신랑 이름 <span className="text-[#36534E]">*</span>
            </label>
            <input
              type="text"
              value={form.groom_name}
              onChange={(e) => update("groom_name", e.target.value)}
              className={inputCls}
              placeholder="준호"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            결혼 날짜 <span className="text-[#36534E]">*</span>
          </label>
          <input
            type="date"
            value={form.wedding_date}
            onChange={(e) => update("wedding_date", e.target.value)}
            className={inputCls}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">예식 장소</label>
          <input
            type="text"
            value={form.venue}
            onChange={(e) => update("venue", e.target.value)}
            className={inputCls}
            placeholder="그랜드 하얏트 서울"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">우리의 이야기</label>
          <textarea
            value={form.our_story}
            onChange={(e) => update("our_story", e.target.value)}
            rows={5}
            className={`${inputCls} resize-none`}
            placeholder="두 사람이 어떻게 만났는지 들려주세요..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">프로포즈 이야기</label>
          <textarea
            value={form.proposal_story}
            onChange={(e) => update("proposal_story", e.target.value)}
            rows={4}
            className={`${inputCls} resize-none`}
            placeholder="프로포즈 순간의 추억..."
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-[#36534E] text-white rounded-xl py-3 px-6 font-medium shadow-[0_4px_14px_0_rgba(6,26,52,0.2)] hover:shadow-[0_6px_20px_rgba(6,26,52,0.23)] transition-all disabled:opacity-60"
        >
          {submitting ? "만드는 중..." : "방명록 만들기"}
        </button>
      </form>
    </div>
  );
}
