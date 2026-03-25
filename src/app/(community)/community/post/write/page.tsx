"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  ArrowLeft,
  Loader2,
  Eye,
  Lock,
  FileText,
  Globe,
  Users,
  Save,
  Pencil,
  Check,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { COMMUNITY_CATEGORIES, CATEGORY_MAP } from "@/constants/communityCategories";
import { useCommunityStore } from "@/stores/communityStore";
import ImageUploader from "@/components/community/ImageUploader";
import TagInput from "@/components/community/TagInput";
import VendorTagPicker from "@/components/community/VendorTagPicker";
import CostShareEditor from "@/components/community/CostShareEditor";
import { sanitizeHtml } from "@/utils/sanitize";
import type {
  CommunityCategory,
  PostVisibility,
  CostShareData,
  CreatePostInput,
} from "@/types/community.types";

// 로컬스토리지 키
const DRAFT_KEY = "community_post_draft";

// 글자수 제한
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 50000;

interface DraftData {
  category: CommunityCategory | null;
  title: string;
  content: string;
  visibility: PostVisibility;
  images: string[];
  tags: string[];
  vendorTags: string[];
  costData: CostShareData;
  savedAt: number;
}

function emptyCostData(): CostShareData {
  return {
    totalCost: 0,
    region: "",
    guestCount: 0,
    weddingDate: "",
    categories: [],
    regretPoints: "",
    goodPoints: "",
    advice: "",
  };
}

// 동적으로 아이콘 컴포넌트 가져오기
function getIcon(name: string) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return Icon || LucideIcons.FileText;
}

export default function PostWritePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-[#6B7280] animate-spin" /></div>}>
      <PostWriteContent />
    </Suspense>
  );
}

function PostWriteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditMode = Boolean(editId);

  const { createPost, updatePost } = useCommunityStore();

  // 인증 상태
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // 폼 상태
  const [category, setCategory] = useState<CommunityCategory | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [images, setImages] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [vendorTags, setVendorTags] = useState<string[]>([]);
  const [costData, setCostData] = useState<CostShareData>(emptyCostData());

  // UI 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [autoSaveFlash, setAutoSaveFlash] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 초기 폼 상태 (변경 감지용)
  const initialFormRef = useRef<string>("");

  // 인증 체크
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        const redirect = encodeURIComponent(
          `/community/post/write${editId ? `?edit=${editId}` : ""}`
        );
        router.replace(`/login?redirect=${redirect}`);
        return;
      }
      setUserId(data.user.id);
      setAuthChecked(true);
    });
  }, [router, editId]);

  // 수정 모드: 기존 글 로드
  useEffect(() => {
    if (!editId || !authChecked) return;

    async function loadPost() {
      setLoadingPost(true);
      try {
        const res = await fetch(`/api/community/posts/${editId}`);
        if (!res.ok) throw new Error("글을 불러올 수 없습니다.");
        const post = await res.json();

        // 작성자 확인
        if (post.author_id !== userId) {
          setError("본인이 작성한 글만 수정할 수 있습니다.");
          setLoadingPost(false);
          return;
        }

        setCategory(post.category);
        setTitle(post.title);
        setContent(post.content);
        setVisibility(post.visibility);
        setImages(post.images || []);
        setTags(post.tags || []);
        setVendorTags(post.vendor_tags || []);
        if (post.cost_data) setCostData(post.cost_data);

        // 초기 상태 저장
        initialFormRef.current = JSON.stringify({
          category: post.category,
          title: post.title,
          content: post.content,
          visibility: post.visibility,
          images: post.images || [],
          tags: post.tags || [],
          vendorTags: post.vendor_tags || [],
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "글을 불러올 수 없습니다."
        );
      } finally {
        setLoadingPost(false);
      }
    }

    loadPost();
  }, [editId, authChecked, userId]);

  // 새 글 모드: 임시저장 복원
  useEffect(() => {
    if (isEditMode || !authChecked) return;

    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft: DraftData = JSON.parse(raw);
      // 24시간 이내 임시저장만 복원
      if (Date.now() - draft.savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setCategory(draft.category);
      setTitle(draft.title || "");
      setContent(draft.content || "");
      setVisibility(draft.visibility || "public");
      setImages(draft.images || []);
      setTags(draft.tags || []);
      setVendorTags(draft.vendorTags || []);
      if (draft.costData) setCostData(draft.costData);
      setDraftRestored(true);
    } catch {
      // 파싱 실패 시 무시
    }
  }, [isEditMode, authChecked]);

  // 변경 감지 (unsaved changes)
  useEffect(() => {
    const currentForm = JSON.stringify({
      category,
      title,
      content,
      visibility,
      images,
      tags,
      vendorTags,
    });
    // 아무것도 입력하지 않은 빈 상태는 변경으로 취급하지 않음
    const isEmpty = !category && !title && !content && images.length === 0 && tags.length === 0 && vendorTags.length === 0;
    if (isEmpty) {
      setHasUnsavedChanges(false);
    } else if (isEditMode) {
      setHasUnsavedChanges(currentForm !== initialFormRef.current);
    } else {
      setHasUnsavedChanges(true);
    }
  }, [category, title, content, visibility, images, tags, vendorTags, isEditMode]);

  // beforeunload 경고
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // 자동 저장 (30초마다)
  useEffect(() => {
    if (isEditMode) return;

    autoSaveRef.current = setInterval(() => {
      const draft: DraftData = {
        category,
        title,
        content,
        visibility,
        images,
        tags,
        vendorTags,
        costData,
        savedAt: Date.now(),
      };
      // 비어있으면 저장하지 않음
      if (!title && !content && !category) return;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        // 자동 저장 표시
        setAutoSaveFlash(true);
        setTimeout(() => setAutoSaveFlash(false), 2000);
      } catch {
        // 스토리지 가득 찬 경우 무시
      }
    }, 30000);

    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    };
  }, [isEditMode, category, title, content, visibility, images, tags, vendorTags, costData]);

  // 텍스트 영역 자동 높이 조절
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [content, autoResize]);

  // 선택된 카테고리 정보
  const categoryInfo = category ? CATEGORY_MAP[category] : null;

  // 유효성 검사
  const isValid = category && title.trim().length > 0 && content.trim().length > 0;

  // 콘텐츠를 간이 HTML로 변환 (미리보기용, 줄바꿈 처리)
  const renderPreviewHtml = useCallback(() => {
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br />");
    return sanitizeHtml(`<p>${escaped}</p>`);
  }, [content]);

  // 제출
  const handleSubmit = async (asDraft = false) => {
    if (isSubmitting) return;
    if (!category || !title.trim() || !content.trim()) {
      setError("카테고리, 제목, 내용을 모두 입력해 주세요.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const input: CreatePostInput = {
      category,
      title: title.trim(),
      content: content.trim(),
      visibility: asDraft ? "draft" : visibility,
      images,
      tags,
      vendor_tags: vendorTags,
      ...(category === "cost_share" ? { cost_data: costData } : {}),
    };

    try {
      if (isEditMode && editId) {
        const success = await updatePost(editId, input);
        if (!success) throw new Error("수정에 실패했습니다.");
        // 임시저장 삭제
        localStorage.removeItem(DRAFT_KEY);
        setHasUnsavedChanges(false);
        router.push(`/community/post/${editId}`);
      } else {
        const postId = await createPost(input);
        if (!postId) throw new Error("작성에 실패했습니다.");
        // 임시저장 삭제
        localStorage.removeItem(DRAFT_KEY);
        setHasUnsavedChanges(false);
        if (asDraft) {
          router.push("/community");
        } else {
          router.push(`/community/post/${postId}`);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "오류가 발생했습니다."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 취소 핸들러
  const handleCancel = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("작성 중인 내용이 있습니다. 정말 나가시겠습니까?");
      if (!confirmed) return;
    }
    setHasUnsavedChanges(false);
    router.back();
  };

  // 인증 확인 전 로딩
  if (!authChecked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#2563EB] animate-spin" />
      </div>
    );
  }

  // 수정 모드 글 로딩
  if (loadingPost) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#2563EB] animate-spin" />
      </div>
    );
  }

  // 글자수 경고 색상
  const titleCountColor = title.length >= TITLE_MAX_LENGTH
    ? "text-red-500"
    : title.length >= TITLE_MAX_LENGTH * 0.9
      ? "text-amber-500"
      : "text-[#6B7280]";

  const contentCountColor = content.length >= CONTENT_MAX_LENGTH
    ? "text-red-500"
    : content.length >= CONTENT_MAX_LENGTH * 0.9
      ? "text-amber-500"
      : "text-[#6B7280]";

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 pb-32 sm:pb-10">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleCancel}
          className="p-2 text-[#6B7280] hover:text-[#1c1c1e] hover:bg-[#F4F6F8] rounded-lg transition-colors"
          aria-label="뒤로 가기"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-[#1c1c1e]">
          {isEditMode ? "글 수정" : "글쓰기"}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {draftRestored && !isEditMode && (
            <span className="text-xs text-[#2563EB]">
              임시저장 복원됨
            </span>
          )}
          {/* 자동 저장 표시 */}
          {autoSaveFlash && (
            <span className="flex items-center gap-1 text-xs text-emerald-500 animate-pulse">
              <Check className="w-3 h-3" />
              자동 저장됨
            </span>
          )}
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mb-6 px-4 py-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl">
          {error}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 메인 영역: 제목 + 본문 */}
        <div className="flex-1 space-y-6">
          {/* 제목 */}
          <section>
            <label className="block text-sm font-medium text-[#1c1c1e] mb-2">
              제목 <span className="text-[#2563EB]">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX_LENGTH))}
              placeholder="제목을 입력하세요"
              maxLength={TITLE_MAX_LENGTH}
              className="w-full px-4 py-3 text-[#1c1c1e] bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg placeholder:text-[#6B7280] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/30 transition-colors"
            />
            <p className={`mt-2 text-xs text-right ${titleCountColor}`}>
              {title.length.toLocaleString()} / {TITLE_MAX_LENGTH.toLocaleString()}자
            </p>
          </section>

          {/* 작성/미리보기 탭 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[#1c1c1e]">
                내용 <span className="text-[#2563EB]">*</span>
              </label>
              <div className="flex bg-[#E5E7EB] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab("write")}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    activeTab === "write"
                      ? "bg-[#2563EB] text-white shadow-sm"
                      : "text-[#6B7280] hover:text-[#1c1c1e]"
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                  작성
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("preview")}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                    activeTab === "preview"
                      ? "bg-[#2563EB] text-white shadow-sm"
                      : "text-[#6B7280] hover:text-[#1c1c1e]"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  미리보기
                </button>
              </div>
            </div>

            {activeTab === "write" ? (
              <>
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value.slice(0, CONTENT_MAX_LENGTH));
                    autoResize();
                  }}
                  placeholder="내용을 입력하세요..."
                  maxLength={CONTENT_MAX_LENGTH}
                  className="w-full px-4 py-3 text-[#1c1c1e] bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg placeholder:text-[#6B7280] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/30 transition-colors resize-none leading-relaxed min-h-[200px]"
                />
                <p className={`mt-2 text-xs text-right ${contentCountColor}`}>
                  {content.length.toLocaleString()} / {CONTENT_MAX_LENGTH.toLocaleString()}자
                </p>
              </>
            ) : (
              <div className="w-full px-4 py-3 bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg min-h-[200px]">
                {content.trim() ? (
                  <div
                    className="prose prose-sm max-w-none text-[#1c1c1e] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderPreviewHtml() }}
                  />
                ) : (
                  <p className="text-[#6B7280] text-sm">미리볼 내용이 없습니다.</p>
                )}
              </div>
            )}
          </section>

          {/* 이미지 업로드 */}
          <section>
            <label className="block text-sm font-medium text-[#1c1c1e] mb-2">
              이미지
            </label>
            <ImageUploader images={images} onChange={setImages} max={5} />
          </section>
        </div>

        {/* 사이드바 영역: 카테고리, 태그, 공개범위 등 메타 */}
        <div className="lg:w-72 shrink-0 space-y-6">
          {/* 카테고리 선택 */}
          <section className="bg-white border border-[#E5E7EB] rounded-xl p-4">
            <label className="block text-sm font-medium text-[#1c1c1e] mb-3">
              카테고리 <span className="text-[#2563EB]">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {COMMUNITY_CATEGORIES.map((cat) => {
                const Icon = getIcon(cat.icon);
                const isSelected = category === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setCategory(cat.key)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                      isSelected
                        ? "border-[#2563EB] bg-[#2563EB] text-white shadow-sm"
                        : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#D1D5DB] hover:text-[#1c1c1e]"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{cat.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 공개 범위 */}
          <section className="bg-white border border-[#E5E7EB] rounded-xl p-4">
            <label className="block text-sm font-medium text-[#1c1c1e] mb-3">
              공개 범위
            </label>
            <div className="space-y-2">
              {[
                { key: "public" as PostVisibility, label: "전체 공개", icon: Globe },
                { key: "members" as PostVisibility, label: "회원 공개", icon: Users },
                { key: "draft" as PostVisibility, label: "임시저장", icon: FileText },
              ].map((opt) => {
                const isSelected = visibility === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setVisibility(opt.key)}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-sm font-medium rounded-lg border transition-all ${
                      isSelected
                        ? "border-[#2563EB] bg-[#2563EB] text-white shadow-sm"
                        : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 태그 */}
          <section className="bg-white border border-[#E5E7EB] rounded-xl p-4">
            <label className="block text-sm font-medium text-[#1c1c1e] mb-2">
              태그
            </label>
            <TagInput tags={tags} onChange={setTags} max={10} />
          </section>

          {/* 업체 태그 (카테고리가 허용하는 경우) */}
          {categoryInfo?.allowVendorTags && (
            <section className="bg-white border border-[#E5E7EB] rounded-xl p-4">
              <label className="block text-sm font-medium text-[#1c1c1e] mb-2">
                업체 태그
              </label>
              <VendorTagPicker vendorIds={vendorTags} onChange={setVendorTags} />
            </section>
          )}

          {/* 비용 공유 에디터 (cost_share 카테고리) */}
          {category === "cost_share" && (
            <section className="bg-white border border-[#E5E7EB] rounded-xl p-4">
              <label className="block text-sm font-medium text-[#1c1c1e] mb-3">
                비용 내역
              </label>
              <CostShareEditor data={costData} onChange={setCostData} />
            </section>
          )}
        </div>
      </div>

      {/* 하단 버튼 - 데스크탑 */}
      <div className="hidden sm:flex items-center justify-between gap-3 mt-8 pt-6 border-t border-[#E5E7EB]">
        <button
          type="button"
          onClick={handleCancel}
          className="px-6 py-2 text-sm font-medium text-[#6B7280] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F4F6F8] transition-colors"
        >
          취소
        </button>
        <div className="flex items-center gap-3">
          {!isEditMode && (
            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting || !category || !title.trim()}
              className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-[#6B7280] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F4F6F8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" />
              임시저장
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting || !isValid}
            className="flex items-center justify-center gap-2 px-10 py-3 text-base font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : null}
            {isEditMode ? "수정하기" : "발행하기"}
          </button>
        </div>
      </div>

      {/* 하단 버튼 - 모바일 고정 */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E5E7EB] px-4 py-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 text-sm font-medium text-[#6B7280] bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg transition-colors"
        >
          취소
        </button>
        {!isEditMode && (
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={isSubmitting || !category || !title.trim()}
            className="px-4 py-2 text-sm font-medium text-[#6B7280] bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={isSubmitting || !isValid}
          className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          {isEditMode ? "수정하기" : "발행하기"}
        </button>
      </div>
    </div>
  );
}
