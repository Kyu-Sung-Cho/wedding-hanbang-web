"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, Save, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import TagInput from "@/components/community/TagInput";
import { AD_DISCLOSURE_OPTIONS, COMMUNITY_CATEGORIES } from "@/constants/communityCategories";
import { pathWithAuthReturn } from "@/lib/authReturnPath";
import { communityPostPath, isCommunityCategory } from "@/lib/community/routes";
import { createClient } from "@/lib/supabase/client";
import { weddingPath } from "@/lib/weddingPaths";
import { removeLegacyCommunityDraft } from "@/lib/userScopedBrowserStorage";
import type { AdDisclosure, CommunityCategory, CreatePostInput, PostVisibility } from "@/types/community.types";
import { communityHtmlToPlainText } from "@hanbang/shared";

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 50_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textToHtml(value: string): string {
  return value
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function htmlToText(value: string): string {
  if (typeof document === "undefined") {
    return communityHtmlToPlainText(value, { preserveParagraphs: true });
  }
  const container = document.createElement("div");
  container.innerHTML = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n");
  return (container.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

type EditablePost = {
  id: string;
  author_id: string;
  viewer_is_author: boolean;
  category: CommunityCategory;
  title: string;
  content: string;
  visibility: PostVisibility;
  tags?: string[] | null;
  ad_disclosure?: AdDisclosure | null;
  sponsorship_detail?: string | null;
};

export default function PostWritePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <PostWriteContent />
    </Suspense>
  );
}

function PageLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-[#36534e]" aria-hidden="true" />
      <span className="sr-only">글 작성 화면을 불러오는 중</span>
    </div>
  );
}

function PostWriteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const requestedCategory = searchParams.get("category");
  const initialCategory = isCommunityCategory(requestedCategory) ? requestedCategory : null;

  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingPost, setLoadingPost] = useState(Boolean(editId));
  const [category, setCategory] = useState<CommunityCategory | null>(initialCategory);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [tags, setTags] = useState<string[]>([]);
  const [adDisclosure, setAdDisclosure] = useState<AdDisclosure>("general");
  const [sponsorshipDetail, setSponsorshipDetail] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentReturnPath = useMemo(() => {
    const query = searchParams.toString();
    return query ? `/community/post/write?${query}` : "/community/post/write";
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    try {
      removeLegacyCommunityDraft(window.localStorage);
    } catch {
      // Accessing the storage object itself can be blocked. The retired draft
      // is never restored, so cleanup failure must not block server-backed writing.
    }
    const supabase = createClient();

    async function load() {
      const { data, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !data.user) {
        router.replace(pathWithAuthReturn(weddingPath("/login"), currentReturnPath));
        return;
      }

      setUserId(data.user.id);
      setAuthChecked(true);
      if (!editId) return;

      try {
        const response = await fetch(`/api/community/posts/${editId}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as (EditablePost & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error ?? "수정할 글을 불러오지 못했습니다.");
        if (!payload.viewer_is_author) throw new Error("수정 권한이 없습니다.");

        setCategory(payload.category);
        setTitle(payload.title);
        setContent(htmlToText(payload.content));
        setVisibility(payload.visibility);
        setTags(Array.isArray(payload.tags) ? payload.tags : []);
        setAdDisclosure(payload.ad_disclosure ?? "general");
        setSponsorshipDetail(payload.sponsorship_detail ?? "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "수정할 글을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoadingPost(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentReturnPath, editId, router]);

  useEffect(() => {
    if (!dirty) return;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventAccidentalExit);
    return () => window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [dirty]);

  const markDirty = () => setDirty(true);

  const cancel = () => {
    if (dirty && !window.confirm("작성 중인 내용이 있습니다. 나가시겠습니까?")) return;
    setDirty(false);
    router.back();
  };

  const submit = async (asDraft: boolean) => {
    if (submitting) return;
    if (!userId) {
      setError("로그인 상태를 다시 확인해주세요.");
      return;
    }
    if (!category || !title.trim() || !content.trim()) {
      setError("카테고리, 제목, 내용을 모두 입력해주세요.");
      return;
    }
    if (adDisclosure === "sponsored" && sponsorshipDetail.trim().length < 5) {
      setError("협찬이 포함된 글은 받은 혜택을 5자 이상 적어주세요.");
      return;
    }

    const input: CreatePostInput = {
      category,
      title: title.trim(),
      content: textToHtml(content),
      visibility: asDraft ? "draft" : visibility,
      tags,
      ad_disclosure: adDisclosure,
      sponsorship_detail: adDisclosure === "sponsored" ? sponsorshipDetail.trim() : undefined,
    };

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(editId ? `/api/community/posts/${editId}` : "/api/community/posts", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json().catch(() => null)) as {
        post?: { id?: unknown };
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error ?? "게시글을 저장하지 못했습니다.");

      const postId = editId ?? (typeof payload?.post?.id === "string" ? payload.post.id : null);
      if (!postId) throw new Error("저장 결과를 확인하지 못했습니다.");
      setDirty(false);
      router.push(asDraft ? weddingPath("/community/my/posts") : communityPostPath(postId));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "게시글을 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!authChecked || loadingPost) return <PageLoading />;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <button type="button" onClick={cancel} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-[#635b51] hover:bg-[#f6efe5]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          나가기
        </button>
        <span className="rounded-full bg-[#eef4f1] px-3 py-1.5 text-xs font-semibold text-[#36534e]">
          {editId ? "글 수정" : "텍스트 글 작성"}
        </span>
      </div>

      <section className="overflow-hidden rounded-[28px] border border-[#e5d8ca] bg-white shadow-[0_18px_50px_rgba(54,83,78,0.08)]">
        <div className="border-b border-[#eee6dc] bg-[#fbf8f2] px-5 py-5 sm:px-8">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#36534e]" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold text-[#243b37]">경험은 구체적으로, 판단은 독자에게</h1>
              <p className="mt-1 text-sm leading-6 text-[#71675f]">
                계약번호·연락처·얼굴 등 개인정보는 지워주세요. 사진은 보관·삭제 경로가 검증될 때까지 받지 않습니다.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-7 p-5 sm:p-8">
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-[#243b37]">글 성격</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {AD_DISCLOSURE_OPTIONS.map((option) => {
                const selected = adDisclosure === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setAdDisclosure(option.key);
                      markDirty();
                    }}
                    className={`min-h-16 rounded-2xl border px-4 py-3 text-left transition ${selected ? "border-[#36534e] bg-[#eef4f1]" : "border-[#e5d8ca] bg-white hover:bg-[#fbf8f2]"}`}
                    aria-pressed={selected}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-[#243b37]">
                      {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[#7d7166]">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {adDisclosure === "sponsored" && (
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#243b37]">받은 혜택</span>
              <input
                value={sponsorshipDetail}
                onChange={(event) => {
                  setSponsorshipDetail(event.target.value.slice(0, 500));
                  markDirty();
                }}
                placeholder="예: 드레스 피팅비 5만원을 지원받음"
                className="min-h-11 w-full rounded-xl border border-[#d8cec4] px-4 text-sm outline-none focus:border-[#36534e]"
              />
            </label>
          )}

          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-[#243b37]">카테고리</legend>
            <div className="flex flex-wrap gap-2">
              {COMMUNITY_CATEGORIES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setCategory(item.key);
                    markDirty();
                  }}
                  className={`min-h-10 rounded-full border px-4 text-sm font-medium ${category === item.key ? "border-[#36534e] bg-[#36534e] text-white" : "border-[#d8cec4] text-[#635b51] hover:bg-[#fbf8f2]"}`}
                  aria-pressed={category === item.key}
                >
                  {item.shortLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#243b37]">
              제목
              <span className="font-normal text-[#928980]">{title.length}/{TITLE_MAX_LENGTH}</span>
            </span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value.slice(0, TITLE_MAX_LENGTH));
                markDirty();
              }}
              placeholder="무엇을 확인하고 싶은지 한 문장으로 적어주세요"
              className="min-h-12 w-full rounded-xl border border-[#d8cec4] px-4 text-base outline-none focus:border-[#36534e]"
            />
          </label>

          <label className="block">
            <span className="mb-2 flex items-center justify-between text-sm font-semibold text-[#243b37]">
              내용
              <span className="font-normal text-[#928980]">{content.length}/{CONTENT_MAX_LENGTH}</span>
            </span>
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value.slice(0, CONTENT_MAX_LENGTH));
                markDirty();
              }}
              rows={13}
              placeholder={"업체명보다 상황과 조건을 중심으로 적어주세요.\n예: 계약서에는 원본 제공이라고 되어 있는데 보정본 추가 비용 안내를 받았습니다."}
              className="w-full resize-y rounded-2xl border border-[#d8cec4] px-4 py-3 text-[15px] leading-7 outline-none focus:border-[#36534e]"
            />
          </label>

          <div>
            <p className="mb-2 text-sm font-semibold text-[#243b37]">태그</p>
            <TagInput tags={tags} onChange={(nextTags) => { setTags(nextTags); markDirty(); }} max={10} />
          </div>

          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-[#243b37]">공개 범위</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["public", "전체 공개", "로그인하지 않은 사람도 읽을 수 있어요."],
                ["members", "회원 공개", "로그인한 회원만 읽을 수 있어요."],
              ] as const).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setVisibility(value); markDirty(); }}
                  className={`rounded-2xl border px-4 py-3 text-left ${visibility === value ? "border-[#36534e] bg-[#eef4f1]" : "border-[#e5d8ca]"}`}
                  aria-pressed={visibility === value}
                >
                  <span className="block text-sm font-semibold text-[#243b37]">{label}</span>
                  <span className="mt-1 block text-xs text-[#7d7166]">{description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-[#eee6dc] pt-6 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={submitting}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#d8cec4] px-6 text-sm font-semibold text-[#635b51] disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              임시저장
            </button>
            <button
              type="button"
              onClick={() => void submit(false)}
              disabled={submitting}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534e] px-7 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editId ? "수정 내용 저장" : "게시하기"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
