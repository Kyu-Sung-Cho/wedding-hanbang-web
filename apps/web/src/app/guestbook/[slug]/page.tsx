"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Heart,
  Calendar,
  MapPin,
  Send,
  ImagePlus,
  X,
  Loader2,
  Share2,
  Copy,
  Check,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 라이트박스
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // 공유 모달
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // 오너 검증 (커뮤니티 크로스포스트 버튼 노출용)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

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

  // 이미지 업로드
  async function handleImageUpload(file: File) {
    if (uploading) return;
    setSubmitError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slug", slug);
      const res = await fetch("/api/guestbook/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data?.error ?? "사진 업로드에 실패했습니다.");
        return;
      }
      setImageUrl(data.url);
    } catch {
      setSubmitError("사진 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  }

  function clearImage() {
    setImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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
          image_url: imageUrl ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "작성에 실패했습니다.");
      setSubmitSuccess(true);
      setGuestName("");
      setRelation("");
      setMessage("");
      setImageUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessages((prev) => [data.message, ...prev]);
      setTimeout(() => setSubmitSuccess(false), 3000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  // 공유 핸들러
  async function handleShare() {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const shareTitle = guestbook
      ? `${guestbook.bride_name} ❤️ ${guestbook.groom_name} 결혼 방명록`
      : "결혼 방명록";
    const shareText = "축하 메시지를 남겨주세요 🤍";

    // 모바일 — 네이티브 시트
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        return;
      } catch {
        // 사용자가 취소하면 fallback 안 띄움
        return;
      }
    }
    // 데스크탑 — 폴백 모달
    setShareOpen(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const isOwner = !!currentUserId && currentUserId === guestbook?.owner_id;

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

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareTextEncoded = encodeURIComponent(
    `${guestbook.bride_name} ❤️ ${guestbook.groom_name} 결혼 방명록 — 축하 메시지를 남겨주세요`
  );
  const xUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${shareTextEncoded}`;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* 히어로 */}
      <section className="relative">
        {/* 공유 버튼 (히어로 우측 상단) */}
        <button
          type="button"
          onClick={handleShare}
          className="absolute top-4 right-4 z-10 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/90 backdrop-blur-sm text-[#1A1A1F] text-sm font-medium shadow-md hover:bg-white transition-colors"
          aria-label="방명록 공유"
        >
          <Share2 className="w-4 h-4" />
          공유
        </button>

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
            두 사람에게 따뜻한 한 마디를 남겨주세요. 사진도 한 장 함께 보낼 수 있어요.
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

            {/* 이미지 첨부 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageUpload(f);
              }}
            />
            {imageUrl ? (
              <div className="flex items-center gap-3 p-3 bg-[#FAFAF8] border border-[#F0EFED] rounded-xl">
                <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#F0EFED] bg-white shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="첨부 사진"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1F]">사진 첨부됨</p>
                  <p className="text-xs text-[#878680]">메시지와 함께 전송됩니다</p>
                </div>
                <button
                  type="button"
                  onClick={clearImage}
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#878680] hover:text-red-500 hover:bg-red-50 transition-colors"
                  aria-label="사진 제거"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center justify-center gap-2 w-full px-4 py-3 text-sm font-medium text-[#504444] bg-[#FAFAF8] border border-dashed border-[#E4E2E1] rounded-xl hover:border-[#C4967E] hover:text-[#C4967E] hover:bg-white transition-colors disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    업로드 중...
                  </>
                ) : (
                  <>
                    <ImagePlus className="w-4 h-4" />
                    사진 첨부 (선택, 5MB 이하)
                  </>
                )}
              </button>
            )}

            {submitError && <p className="text-sm text-[#EF4444]">{submitError}</p>}
            {submitSuccess && (
              <p className="text-sm text-[#C4967E]">메시지가 전달되었어요. 감사합니다.</p>
            )}

            <button
              type="submit"
              disabled={submitting || uploading}
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
                <article
                  key={m.id}
                  className="bg-white border border-[#F0EFED] rounded-2xl p-5"
                >
                  <header className="flex items-center gap-2 mb-2">
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
                  </header>
                  <p className="text-[#1A1A1F] leading-relaxed whitespace-pre-wrap text-[15px]">
                    {m.message}
                  </p>

                  {/* 첨부 이미지 */}
                  {m.image_url && (
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(m.image_url)}
                      className="mt-3 block w-full max-w-[280px] aspect-square rounded-xl overflow-hidden border border-[#F0EFED] bg-[#FAFAF8] hover:opacity-90 transition-opacity"
                      aria-label="사진 확대"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.image_url}
                        alt={`${m.guest_name}님이 보낸 사진`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  )}

                  {/* 오너 전용: 커뮤니티 크로스포스트 */}
                  {isOwner && (
                    <div className="mt-3 pt-3 border-t border-[#F5F2ED] flex justify-end">
                      <Link
                        href={`/community/post/write?prefill=guestbook&slug=${encodeURIComponent(slug)}&msg=${encodeURIComponent(m.id)}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#795252] bg-[#fcf9f8] border border-[#F0EFED] rounded-lg hover:border-[#795252] hover:bg-white transition-colors"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        커뮤니티에 후기로 올리기
                      </Link>
                    </div>
                  )}
                </article>
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

      {/* 라이트박스 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(null);
            }}
            className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 공유 폴백 모달 (데스크탑) */}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className="font-serif text-xl font-medium text-[#1A1A1F]"
                style={{ fontFamily: "'Noto Serif KR', serif" }}
              >
                방명록 공유하기
              </h3>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#928980] hover:text-[#1A1A1F] hover:bg-[#F6F3F2] transition-colors"
                aria-label="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-[#504444] mb-5">
              친구들이 이 방명록에 와서 메시지를 남길 수 있도록 공유해주세요.
            </p>

            {/* URL 표시 + 복사 */}
            <div className="flex items-stretch gap-2 mb-3">
              <div className="flex-1 px-3 py-2.5 bg-[#FAFAF8] border border-[#F0EFED] rounded-lg text-sm text-[#504444] truncate min-w-0">
                {shareUrl}
              </div>
              <button
                type="button"
                onClick={copyLink}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-lg text-sm font-medium transition-all ${
                  copied
                    ? "bg-[#2E7D5A] text-white"
                    : "bg-[#795252] text-white hover:bg-[#946a6a]"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    복사됨
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    복사
                  </>
                )}
              </button>
            </div>

            {/* SNS 인텐트 */}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#F0EFED] text-sm font-medium text-[#1A1A1F] hover:bg-[#FAFAF8] transition-colors"
              >
                𝕏
                <span>X (Twitter)</span>
              </a>
              <a
                href={fbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#F0EFED] text-sm font-medium text-[#1A1A1F] hover:bg-[#FAFAF8] transition-colors"
              >
                <span className="text-[#1877F2] font-bold">f</span>
                <span>페이스북</span>
              </a>
            </div>

            <p className="text-xs text-[#928980] mt-3 text-center">
              <Sparkles className="w-3 h-3 inline mr-1" />
              인스타그램은 링크를 복사해 스토리/DM에 붙여넣어주세요.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
