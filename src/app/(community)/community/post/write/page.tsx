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
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { COMMUNITY_CATEGORIES, CATEGORY_MAP } from "@/constants/communityCategories";
import { useCommunityStore } from "@/stores/communityStore";
import ImageUploader from "@/components/community/ImageUploader";
import TagInput from "@/components/community/TagInput";
import VendorTagPicker from "@/components/community/VendorTagPicker";
import CostShareEditor from "@/components/community/CostShareEditor";
import type {
  CommunityCategory,
  PostVisibility,
  CostShareData,
  CreatePostInput,
} from "@/types/community.types";

// 로컬스토리지 키
const DRAFT_KEY = "community_post_draft";

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
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-[#B5ADA3] animate-spin" /></div>}>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
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

  // 제출
  const handleSubmit = async (asDraft = false) => {
    if (!category || !title.trim() || !content.trim()) {
      setError("카테고리, 제목, 내용을 모두 입력해 주세요.");
      return;
    }

    setError(null);
    setSubmitting(true);

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
        router.push(`/community/post/${editId}`);
      } else {
        const postId = await createPost(input);
        if (!postId) throw new Error("작성에 실패했습니다.");
        // 임시저장 삭제
        localStorage.removeItem(DRAFT_KEY);
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
      setSubmitting(false);
    }
  };

  // 인증 확인 전 로딩
  if (!authChecked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C4967E] animate-spin" />
      </div>
    );
  }

  // 수정 모드 글 로딩
  if (loadingPost) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#C4967E] animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-32 sm:pb-10">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 text-[#928980] hover:text-[#1A1A1F] hover:bg-[#FAF8F5] rounded-xl transition-colors"
          aria-label="뒤로 가기"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-medium text-[#1A1A1F]">
          {isEditMode ? "글 수정" : "글쓰기"}
        </h1>
        {draftRestored && !isEditMode && (
          <span className="ml-auto text-xs text-[#C4967E]">
            임시저장 복원됨
          </span>
        )}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="mb-5 px-4 py-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-2xl">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* 1. 카테고리 선택 */}
        <section>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-3">
            카테고리 <span className="text-[#C4967E]">*</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {COMMUNITY_CATEGORIES.map((cat) => {
              const Icon = getIcon(cat.icon);
              const isSelected = category === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setCategory(cat.key)}
                  className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                    isSelected
                      ? "border-[#C4967E] bg-[#C4967E]/10 text-[#C4967E]"
                      : "border-[#F5F2ED] bg-white text-[#928980] hover:border-[#B5ADA3] hover:text-[#1A1A1F]"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{cat.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. 제목 */}
        <section>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            제목 <span className="text-[#C4967E]">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            placeholder="제목을 입력하세요"
            maxLength={100}
            className="w-full px-4 py-3 text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-2xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors"
          />
          <p className="mt-1.5 text-xs text-[#B5ADA3] text-right">
            {title.length}/100
          </p>
        </section>

        {/* 3. 공개 범위 */}
        <section>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            공개 범위
          </label>
          <div className="flex gap-2">
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
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors ${
                    isSelected
                      ? "border-[#C4967E] bg-[#C4967E]/10 text-[#C4967E]"
                      : "border-[#F5F2ED] bg-white text-[#928980] hover:border-[#B5ADA3]"
                  }`}
                >
                  <opt.icon className="w-4 h-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* 4. 본문 */}
        <section>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            내용 <span className="text-[#C4967E]">*</span>
          </label>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              autoResize();
            }}
            placeholder="내용을 입력하세요..."
            className="w-full px-4 py-3 text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-2xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors resize-none leading-relaxed"
            style={{ minHeight: "200px" }}
          />
        </section>

        {/* 5. 이미지 업로드 */}
        <section>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            이미지
          </label>
          <ImageUploader images={images} onChange={setImages} max={5} />
        </section>

        {/* 6. 태그 */}
        <section>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            태그
          </label>
          <TagInput tags={tags} onChange={setTags} max={10} />
        </section>

        {/* 7. 업체 태그 (카테고리가 허용하는 경우) */}
        {categoryInfo?.allowVendorTags && (
          <section>
            <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
              업체 태그
            </label>
            <VendorTagPicker vendorIds={vendorTags} onChange={setVendorTags} />
          </section>
        )}

        {/* 8. 비용 공유 에디터 (cost_share 카테고리) */}
        {category === "cost_share" && (
          <section>
            <label className="block text-sm font-medium text-[#1A1A1F] mb-3">
              비용 내역
            </label>
            <CostShareEditor data={costData} onChange={setCostData} />
          </section>
        )}
      </div>

      {/* 하단 버튼 - 데스크탑 */}
      <div className="hidden sm:flex items-center justify-end gap-3 mt-8 pt-6 border-t border-[#F5F2ED]">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2.5 text-sm font-medium text-[#928980] bg-white border border-[#F5F2ED] rounded-xl hover:bg-[#FAF8F5] transition-colors"
        >
          취소
        </button>
        {!isEditMode && (
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={submitting || !category || !title.trim()}
            className="flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium text-[#928980] bg-white border border-[#F5F2ED] rounded-xl hover:bg-[#FAF8F5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            임시저장
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={submitting || !isValid}
          className="flex items-center gap-1.5 px-8 py-2.5 text-sm font-medium text-white bg-[#C4967E] rounded-xl hover:bg-[#9A6B62] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          {isEditMode ? "수정하기" : "발행하기"}
        </button>
      </div>

      {/* 하단 버튼 - 모바일 고정 */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#F5F2ED] px-4 py-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 text-sm font-medium text-[#928980] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl transition-colors"
        >
          취소
        </button>
        {!isEditMode && (
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={submitting || !category || !title.trim()}
            className="px-4 py-2.5 text-sm font-medium text-[#928980] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={submitting || !isValid}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-white bg-[#C4967E] rounded-xl hover:bg-[#9A6B62] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          {isEditMode ? "수정하기" : "발행하기"}
        </button>
      </div>
    </div>
  );
}
