"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  FileText,
  Loader2,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ArrowLeft,
  Save,
  X,
  CheckCircle2,
  MessageCircle,
} from "lucide-react";
import Link from "next/link";
import Avatar from "@/components/community/Avatar";
import CommunityConfigurationUnavailable from "@/components/community/CommunityConfigurationUnavailable";
import { useAuthStore } from "@/stores/authStore";
import type { CommunityProfile, CommunityRank, PostWithAuthor } from "@/types/community.types";
import { CATEGORY_MAP } from "@/constants/communityCategories";
import { communityPostPath } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";
import { timeAgo } from "@/utils/timeAgo";

const avatarOptions = ["🌿", "💍", "🌸", "🤍", "✨", "👑"];

const rankLabels: Record<CommunityRank, string> = {
  sprout: "새싹",
  preparing: "준비중",
  expert: "체크",
  master: "마스터",
  senior: "선배",
};

export default function MyPostsPage() {
  const router = useRouter();
  const appProfile = useAuthStore((state) => state.profile);
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"published" | "draft">("published");
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  const [avatarInput, setAvatarInput] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const configurationUnavailable =
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    connectionFailed;

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          router.push(`/login?redirect=${encodeURIComponent(weddingPath("/community/my/posts"))}`);
          return;
        }
        setUserId(user.id);
      } catch {
        if (!cancelled) {
          setConnectionFailed(true);
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => setLoading(true), 0);
    const controller = new AbortController();
    fetch(`/api/community/posts?author_id=${userId}&limit=100`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => { setPosts(data.posts ?? []); setLoading(false); })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoading(false);
      });
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const loadProfile = async () => {
      let response = await fetch("/api/community/profile", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      let data = await response.json();
      if (!data?.profile) {
        response = await fetch("/api/community/profile", {
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok) return;
        data = await response.json();
      }
      if (!controller.signal.aborted) {
        const nextProfile = data?.profile as CommunityProfile | undefined;
        if (!nextProfile) return;
        setProfile(nextProfile);
        setNicknameInput(nextProfile.nickname);
        setAvatarInput(nextProfile.avatar_url);
      }
    };
    void loadProfile().catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [userId]);

  if (configurationUnavailable) {
    return (
      <CommunityConfigurationUnavailable
        retryHref={weddingPath("/community/my/posts")}
      />
    );
  }

  const published = posts.filter((p) => p.visibility !== "draft");
  const drafts = posts.filter((p) => p.visibility === "draft");
  const displayed = tab === "published" ? published : drafts;

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/community/posts/${id}`, { method: "DELETE" });
    if (res.ok) setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  const saveProfile = async () => {
    if (!profile) return;
    const nickname = nicknameInput.trim();
    if (!nickname) {
      setProfileMessage("닉네임을 입력해 주세요.");
      return;
    }
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await fetch("/api/community/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, avatar_url: avatarInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileMessage(data.error ?? "프로필 저장에 실패했습니다.");
        return;
      }
      setProfile(data.profile);
      setEditingProfile(false);
      setProfileMessage("프로필이 저장되었습니다.");
    } catch {
      setProfileMessage("프로필 저장 중 오류가 발생했습니다.");
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href={weddingPath()} className="w-8 h-8 rounded-full bg-white border border-black/[0.06] flex items-center justify-center hover:bg-[var(--hb-surface-hover)] transition-colors">
          <ArrowLeft className="w-4 h-4 text-[var(--hb-text-strong)]" />
        </Link>
        <h1 className="font-serif-kr text-[20px] text-[var(--hb-text-strong)]">내 글</h1>
      </div>

      {profile && (
        <section className="mb-6 rounded-2xl border border-[var(--hb-hairline)] bg-white px-5 py-4 shadow-[0_8px_22px_rgba(8,22,38,0.035)]">
          <div className="flex items-start gap-4">
            <Avatar
              nickname={nicknameInput || profile.nickname}
              avatarUrl={avatarInput}
              role={profile.role ?? appProfile?.role ?? null}
              size={56}
            />
            <div className="min-w-0 flex-1">
              {editingProfile ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={nicknameInput}
                    onChange={(event) => setNicknameInput(event.target.value)}
                    maxLength={20}
                    className="h-10 w-full rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-3 text-sm font-medium text-[var(--hb-text-strong)] outline-none focus:border-[var(--hb-primary)]"
                    placeholder="커뮤니티 닉네임"
                  />
                  <div className="flex flex-wrap gap-2">
                    {avatarOptions.map((avatar) => (
                      <button
                        key={avatar}
                        type="button"
                        onClick={() => setAvatarInput(avatar)}
                        className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition-colors ${
                          avatarInput === avatar
                            ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
                            : "border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] hover:border-[var(--hb-primary)]"
                        }`}
                        aria-label={`${avatar} 아바타 선택`}
                      >
                        {avatar}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveProfile}
                      disabled={profileSaving}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] bg-[var(--hb-primary)] px-4 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingProfile(false);
                        setNicknameInput(profile.nickname);
                        setAvatarInput(profile.avatar_url);
                        setProfileMessage(null);
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-4 text-xs font-semibold text-[var(--hb-text-muted)]"
                    >
                      <X className="h-3.5 w-3.5" />
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-[var(--hb-text-strong)]">{profile.nickname}</p>
                      <span className="rounded-full bg-[var(--hb-surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--hb-text-strong)]">
                        {rankLabels[profile.rank] ?? "회원"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-[var(--hb-text-muted)]">커뮤니티에 표시되는 프로필입니다.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNicknameInput(profile.nickname);
                      setAvatarInput(profile.avatar_url);
                      setEditingProfile(true);
                    }}
                    className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-4 text-xs font-semibold text-[var(--hb-text-strong)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    프로필 수정
                  </button>
                </div>
              )}
              {profileMessage && <p className="mt-3 text-xs font-medium text-[var(--hb-text-strong)]">{profileMessage}</p>}
            </div>
          </div>
        </section>
      )}

      {/* 탭 */}
      <div className="flex gap-2 mb-6">
        {[
          { key: "published" as const, label: "발행됨", count: published.length },
          { key: "draft" as const, label: "임시저장", count: drafts.length },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-[13px] font-medium transition-colors ${
              tab === t.key ? "bg-[var(--hb-primary)] text-white" : "bg-white border border-black/[0.06] text-[var(--hb-text-muted)] hover:bg-[var(--hb-surface-hover)]"
            }`}
          >
            {t.label} {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 text-[var(--hb-text-muted)] animate-spin" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center">
          <FileText className="w-10 h-10 text-[var(--hb-text-muted)]/40 mx-auto mb-3" />
          <p className="text-[14px] text-[var(--hb-text-muted)]">
            {tab === "published" ? "아직 작성한 글이 없습니다" : "임시저장된 글이 없습니다"}
          </p>
          <Link href={weddingPath("/community/post/write")} className="inline-block mt-4 px-5 py-2.5 rounded-xl text-[13px] font-medium text-white bg-[var(--hb-primary)] hover:bg-[#9A6B62] transition-colors">
            글쓰기
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((post) => {
            const cat = CATEGORY_MAP[post.category];
            const isResolutionPost =
              post.category === "is_normal" || post.category === "ama";
            return (
              <div key={post.id} className="bg-white rounded-2xl border border-black/[0.04] px-5 py-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {cat && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cat.bgColor} ${cat.color}`}>
                          {cat.shortLabel}
                        </span>
                      )}
                      {post.visibility === "members" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium flex items-center gap-0.5">
                          <EyeOff className="w-2.5 h-2.5" /> 회원
                        </span>
                      )}
                      {isResolutionPost && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            post.is_resolved
                              ? "bg-[#C7D1C2]/45 text-[var(--hb-text-strong)]"
                              : "bg-[var(--hb-surface-hover)] text-[var(--color-rose-700)]"
                          }`}
                        >
                          {post.is_resolved && (
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          )}
                          {post.is_resolved ? "해결됨" : "답변 받는 중"}
                        </span>
                      )}
                    </div>
                    <Link href={communityPostPath(post.id)} className="text-[14px] font-medium text-[var(--hb-text-strong)] hover:underline line-clamp-1">
                      {post.title}
                    </Link>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-[var(--hb-text-muted)]">
                      <span suppressHydrationWarning>{timeAgo(post.created_at)}</span>
                      <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" /> {post.view_count}</span>
                      <span>좋아요 {post.upvote_count}</span>
                      <Link
                        href={communityPostPath(post.id, "comments")}
                        className="inline-flex items-center gap-0.5 text-[var(--hb-text-body)] hover:text-[var(--hb-text-strong)] hover:underline"
                      >
                        <MessageCircle className="h-3 w-3" />
                        답변 {post.comment_count}
                      </Link>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Link
                      href={weddingPath(`/community/post/write?edit=${post.id}`)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--hb-text-muted)] hover:bg-[var(--hb-surface-hover)] transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      onClick={() => handleDelete(post.id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--hb-text-muted)] hover:bg-red-50 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
