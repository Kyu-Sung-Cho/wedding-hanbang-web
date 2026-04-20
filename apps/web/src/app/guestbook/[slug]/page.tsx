"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Heart, Calendar, MapPin, Send } from "lucide-react";
import { GUEST_RELATIONS } from "@/constants/communityCategories";
import { timeAgo } from "@/utils/timeAgo";
import type { Guestbook, GuestbookMessage, GuestRelation } from "@/types/community.types";

const RELATION_LABEL: Record<GuestRelation, string> = {
  university_friend: "대학친구",
  work_colleague: "직장동료",
  family: "가족",
  old_friend: "오래된 친구",
  partner: "파트너 지인",
  other: "기타",
};

export default function PublicGuestbookPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [loading, setLoading] = useState(true);
  const [guestbook, setGuestbook] = useState<Guestbook | null>(null);
  const [messages, setMessages] = useState<GuestbookMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [guestName, setGuestName] = useState("");
  const [relation, setRelation] = useState<GuestRelation | "">("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guestbook/${slug}`);
      if (!res.ok) {
        setError("방명록을 찾을 수 없습니다.");
        return;
      }
      const data = await res.json();
      setGuestbook(data.guestbook);
      setMessages(data.messages ?? []);
    } catch {
      setError("불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    if (!guestName.trim() || !message.trim()) {
      setSubmitError("이름과 메시지를 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/guestbook/${slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guest_name: guestName.trim(),
          relation: relation || undefined,
          message: message.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "작성에 실패했습니다.");
      setSubmitSuccess(true);
      setGuestName("");
      setRelation("");
      setMessage("");
      setMessages((prev) => [data.message, ...prev]);
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none text-base";

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center">
        <p className="text-[#B5ADA3]">불러오는 중...</p>
      </div>
    );
  }

  if (error || !guestbook) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-4">
        <div className="bg-white border border-[#F0EFED] rounded-2xl p-10 text-center max-w-md w-full">
          <p className="text-[#878680] mb-4">{error ?? "방명록을 찾을 수 없습니다."}</p>
          <Link href="/" className="text-[#C4967E] hover:underline">
            웨딩한방 홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* 히어로 */}
      <section className="relative">
        {guestbook.cover_image_url ? (
          <div className="relative h-80 w-full overflow-hidden">
            <Image
              src={guestbook.cover_image_url}
              alt=""
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 text-white">
              <h1
                className="font-serif text-4xl sm:text-5xl font-medium mb-3"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                {guestbook.bride_name} &amp; {guestbook.groom_name}
              </h1>
              <p className="text-base opacity-90 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {guestbook.wedding_date}
              </p>
              {guestbook.venue && (
                <p className="text-sm opacity-80 mt-1 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  {guestbook.venue}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="h-72 w-full bg-gradient-to-br from-[#FAF8F5] to-[#F5F2ED] flex flex-col items-center justify-center px-4 text-center">
            <h1
              className="font-serif text-4xl sm:text-5xl font-medium text-[#1A1A1F] mb-3"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              {guestbook.bride_name} &amp; {guestbook.groom_name}
            </h1>
            <p className="text-base text-[#878680] flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {guestbook.wedding_date}
            </p>
            {guestbook.venue && (
              <p className="text-sm text-[#B5ADA3] mt-1 flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {guestbook.venue}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {guestbook.our_story && (
          <section className="bg-white border border-[#F0EFED] rounded-2xl p-6 sm:p-8">
            <h2
              className="font-serif text-2xl font-medium text-[#1A1A1F] mb-4"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              우리의 이야기
            </h2>
            <p className="text-[#1A1A1F] leading-relaxed whitespace-pre-wrap text-[15px]">
              {guestbook.our_story}
            </p>
          </section>
        )}

        {guestbook.proposal_story && (
          <section className="bg-white border border-[#F0EFED] rounded-2xl p-6 sm:p-8">
            <h2
              className="font-serif text-2xl font-medium text-[#1A1A1F] mb-4"
              style={{ fontFamily: "'Noto Serif KR', serif" }}
            >
              프로포즈 이야기
            </h2>
            <p className="text-[#1A1A1F] leading-relaxed whitespace-pre-wrap text-[15px]">
              {guestbook.proposal_story}
            </p>
          </section>
        )}

        {/* 메시지 작성 폼 */}
        <section className="bg-white border border-[#F0EFED] rounded-2xl p-6 sm:p-8">
          <h2
            className="font-serif text-2xl font-medium text-[#1A1A1F] mb-2"
            style={{ fontFamily: "'Noto Serif KR', serif" }}
          >
            축하 메시지 남기기
          </h2>
          <p className="text-sm text-[#878680] mb-5">
            두 사람에게 따뜻한 한 마디를 남겨주세요.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="이름"
                className={inputCls}
                maxLength={40}
                required
              />
              <select
                value={relation}
                onChange={(e) => setRelation(e.target.value as GuestRelation | "")}
                className={inputCls}
              >
                <option value="">관계 선택</option>
                {GUEST_RELATIONS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="축하 메시지를 남겨주세요..."
              rows={5}
              className={`${inputCls} resize-none`}
              maxLength={2000}
              required
            />

            {submitError && <p className="text-sm text-[#EF4444]">{submitError}</p>}
            {submitSuccess && (
              <p className="text-sm text-[#C4967E]">메시지가 전달되었어요. 감사합니다.</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl py-3 px-6 font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {submitting ? "보내는 중..." : "메시지 남기기"}
            </button>
          </form>
        </section>

        {/* 메시지 목록 */}
        <section>
          <h2
            className="font-serif text-2xl font-medium text-[#1A1A1F] mb-4"
            style={{ fontFamily: "'Noto Serif KR', serif" }}
          >
            축하 메시지 {messages.length > 0 && <span className="text-[#C4967E]">{messages.length}</span>}
          </h2>

          {messages.length === 0 ? (
            <div className="bg-white border border-[#F0EFED] rounded-2xl p-10 text-center text-[#B5ADA3]">
              첫 번째 축하 메시지를 남겨보세요.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className="bg-white border border-[#F0EFED] rounded-2xl p-5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Heart className="w-4 h-4 text-[#C4967E]" />
                    <span className="font-medium text-[#1A1A1F]">{m.guest_name}</span>
                    {m.relation && (
                      <span className="text-xs px-2 py-0.5 bg-[#FAF8F5] text-[#878680] rounded-full">
                        {RELATION_LABEL[m.relation]}
                      </span>
                    )}
                    <span className="text-xs text-[#B5ADA3] ml-auto">
                      {timeAgo(m.created_at)}
                    </span>
                  </div>
                  <p className="text-[#1A1A1F] leading-relaxed whitespace-pre-wrap text-[15px]">
                    {m.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* CTA */}
        <section className="bg-gradient-to-br from-[#FAF8F5] to-[#F5F2ED] rounded-2xl p-8 text-center">
          <h3
            className="font-serif text-xl font-medium text-[#1A1A1F] mb-2"
            style={{ fontFamily: "'Noto Serif KR', serif" }}
          >
            결혼 준비 중이신가요?
          </h3>
          <p className="text-sm text-[#878680] mb-5">
            같은 달 결혼하는 동기들과 함께 정보를 나누세요.
          </p>
          <Link
            href="/community"
            className="inline-block bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl py-3 px-6 font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all"
          >
            웨딩한방 커뮤니티 둘러보기
          </Link>
        </section>
      </div>

      {/* 푸터 */}
      <footer className="border-t border-[#F0EFED] bg-white py-6 mt-10">
        <div className="text-center text-sm text-[#B5ADA3]">
          Made with{" "}
          <Link
            href="/"
            className="font-serif text-[#1A1A1F] hover:text-[#C4967E] transition"
            style={{ fontFamily: "'Noto Serif KR', serif" }}
          >
            웨딩한방
          </Link>
        </div>
      </footer>
    </div>
  );
}
