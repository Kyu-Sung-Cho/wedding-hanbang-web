"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Eye,
  Globe,
  Users,
  Save,
  Pencil,
  Check,
  ImagePlus,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { COMMUNITY_CATEGORIES, CATEGORY_MAP } from "@/constants/communityCategories";
import { useCommunityStore } from "@/stores/communityStore";
import ImageUploader from "@/components/community/ImageUploader";
import SlideBuilder from "@/components/community/SlideBuilder";
import TagInput from "@/components/community/TagInput";
import VendorTagPicker from "@/components/community/VendorTagPicker";
import PriceQuestionForm from "@/components/community/PriceQuestionForm";
import PollEditor from "@/components/community/PollEditor";
import { sanitizeHtml } from "@/utils/sanitize";
import { communityPostPath } from "@/lib/community/routes";
import { uploadCommunityMedia } from "@/lib/community/uploadMedia";
import {
  communityPostDraftKey,
  readOwnedCommunityPostDraft,
  removeCommunityPostDraft,
} from "@/lib/community/draftStorage";
import { weddingPath } from "@/lib/weddingPaths";
import { consumeQuotePostHandoff } from "@/lib/privacy/oneTimeHandoff";
import { createClient } from "@/lib/supabase/client";
import {
  getCurrentVerifiedUserScopedActor,
  useUserScopedClientActor,
} from "@/components/common/UserScopedClientStateBoundary";
import {
  CommunityActorChangedError,
  runWithExpectedCommunityActor,
} from "@/lib/community/actorFence";
import type {
  CommunityCategory,
  PostVisibility,
  CreatePostInput,
  CreatePollInput,
  AdDisclosure,
  PriceData,
  SlideMedia,
} from "@/types/community.types";

type PostMode = "regular" | "slides";

// 글자수 제한
const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 50000;

interface InlineImageEntry {
  id: string;
  url: string;
}

interface DraftData {
  ownerId: string;
  category: CommunityCategory | null;
  title: string;
  content: string;
  visibility: PostVisibility;
  images: string[];
  tags: string[];
  vendorTags: string[];
  adDisclosure?: AdDisclosure;
  sponsorshipDetail?: string;
  priceData?: PriceData | null;
  poll?: CreatePollInput | null;
  inlineImages?: InlineImageEntry[];
  postMode?: PostMode;
  slides?: SlideMedia[];
  savedAt: number;
}

// 본문 인라인 이미지 토큰 — 작성 중엔 [!img:abc123]로 보이고, 발행 시 <img>로 변환.
// HTML을 textarea에 그대로 두면 200자 raw markup이 보여서 ugly.
const IMG_TOKEN_RE = /\[!img:([a-z0-9]+)\]/g;
const IMG_HTML_RE = /<img\s+[^>]*src="([^"]+)"[^>]*\/?>/gi;
const IMG_STYLE = "max-width:100%;height:auto;border-radius:12px;margin:0.75em 0;";

function newInlineImageId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** 토큰 → <img> HTML 변환. 매핑 없는 토큰은 빈 문자열로 제거. */
function tokensToHtml(content: string, images: InlineImageEntry[]): string {
  return content.replace(IMG_TOKEN_RE, (_, id) => {
    const img = images.find((i) => i.id === id);
    if (!img) return "";
    return `<img src="${img.url}" alt="" style="${IMG_STYLE}" />`;
  });
}

/** 기존 글의 <img> HTML → 토큰. 편집 모드에서 raw HTML 노출 방지. */
function htmlToTokens(html: string): { content: string; images: InlineImageEntry[] } {
  const images: InlineImageEntry[] = [];
  const content = html.replace(IMG_HTML_RE, (_, src) => {
    const id = newInlineImageId();
    images.push({ id, url: src });
    return `[!img:${id}]`;
  });
  return { content, images };
}

// 동적으로 아이콘 컴포넌트 가져오기
function getIcon(name: string) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name];
  return Icon || LucideIcons.FileText;
}

export default function PostWritePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-[#635b51] animate-spin" /></div>}>
      <PostWriteContent />
    </Suspense>
  );
}

function PostWriteContent() {
  const actor = useUserScopedClientActor();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditMode = Boolean(editId);
  const requestedCategory = searchParams.get("category");
  const initialCategory = COMMUNITY_CATEGORIES.some((c) => c.key === requestedCategory)
    ? (requestedCategory as CommunityCategory)
    : null;

  const { createPost, updatePost } = useCommunityStore();

  // 인증 상태
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // 폼 상태
  const [category, setCategory] = useState<CommunityCategory | null>(initialCategory);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const [images, setImages] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [vendorTags, setVendorTags] = useState<string[]>([]);
  const [adDisclosure, setAdDisclosure] = useState<AdDisclosure>("general");
  const [sponsorshipDetail, setSponsorshipDetail] = useState<string>("");
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [poll, setPoll] = useState<CreatePollInput | null>(null);

  // 카드 게시물(인스타 캐러셀) 모드 — 일반 글이면 "regular", 옆으로 넘기는 슬라이드면 "slides"
  const [postMode, setPostMode] = useState<PostMode>("regular");
  const [slides, setSlides] = useState<SlideMedia[]>([]);

  // UI 상태
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [autoSaveFlash, setAutoSaveFlash] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inlineImageInputRef = useRef<HTMLInputElement>(null);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 초기 폼 상태 (변경 감지용)
  const initialFormRef = useRef<string>("");

  // 본문 인라인 이미지 — 토큰([!img:id])로 textarea에 표시, 발행/미리보기 시 HTML 변환
  const [inlineImages, setInlineImages] = useState<InlineImageEntry[]>([]);
  const [insertingImage, setInsertingImage] = useState(false);
  const [insertImageError, setInsertImageError] = useState<string | null>(null);

  // 본문에서 사용 안 하는 inlineImage 자동 정리 (사용자가 토큰을 직접 지웠을 때)
  useEffect(() => {
    if (inlineImages.length === 0) return;
    const usedIds = new Set<string>();
    let m: RegExpExecArray | null;
    const re = new RegExp(IMG_TOKEN_RE.source, "g");
    while ((m = re.exec(content)) !== null) usedIds.add(m[1]);
    if (usedIds.size === inlineImages.length) return;
    const next = inlineImages.filter((img) => usedIds.has(img.id));
    if (next.length !== inlineImages.length) setInlineImages(next);
  }, [content, inlineImages]);

  // 인증 체크
  useEffect(() => {
    let cancelled = false;
    if (actor.status !== "ready") return;
    if (actor.kind !== "user" || !actor.userId) {
      const redirect = encodeURIComponent(
        weddingPath(`/community/post/write${editId ? `?edit=${editId}` : ""}`)
      );
      router.replace(`/login?redirect=${redirect}`);
      return;
    }

    const expectedUserId = actor.userId;
    void createClient().auth.getUser().then(({ data, error: authError }) => {
      if (cancelled) return;
      if (authError || data.user?.id !== expectedUserId) {
        const redirect = encodeURIComponent(
          weddingPath(`/community/post/write${editId ? `?edit=${editId}` : ""}`)
        );
        router.replace(`/login?redirect=${redirect}`);
        return;
      }
      setUserId(expectedUserId);
      setAuthChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [actor.kind, actor.status, actor.userId, router, editId]);

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
        if (post.is_author !== true) {
          setError("본인이 작성한 글만 수정할 수 있습니다.");
          setLoadingPost(false);
          return;
        }

        setCategory(post.category);
        setTitle(post.title);
        // 기존 게시글에 raw <img> HTML이 있으면 토큰으로 역변환 → 편집 화면에서도 깨끗
        {
          const { content: tokenized, images: extracted } = htmlToTokens(post.content);
          setContent(tokenized);
          if (extracted.length) setInlineImages(extracted);
        }
        setVisibility(post.visibility);
        setImages(post.images || []);
        setTags(post.tags || []);
        setVendorTags(post.vendor_tags || []);
        if (post.ad_disclosure) setAdDisclosure(post.ad_disclosure);
        if (post.sponsorship_detail) setSponsorshipDetail(post.sponsorship_detail);
        if (post.price_data) setPriceData(post.price_data);
        // 카드 게시물(슬라이드)이면 모드를 그대로 복원
        if (Array.isArray(post.slides) && post.slides.length > 0) {
          setPostMode("slides");
          setSlides(post.slides);
        }

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
    if (isEditMode || !authChecked || !userId) return;

    try {
      const draft = readOwnedCommunityPostDraft<DraftData>(localStorage, userId);
      if (!draft) return;
      setCategory(draft.category);
      setTitle(draft.title || "");
      setContent(draft.content || "");
      setVisibility(draft.visibility || "public");
      setImages(draft.images || []);
      setTags(draft.tags || []);
      setVendorTags(draft.vendorTags || []);
      if (draft.adDisclosure) setAdDisclosure(draft.adDisclosure);
      if (draft.sponsorshipDetail) setSponsorshipDetail(draft.sponsorshipDetail);
      if (draft.priceData) setPriceData(draft.priceData);
      if (draft.inlineImages?.length) setInlineImages(draft.inlineImages);
      if (draft.poll) setPoll(draft.poll);
      if (draft.postMode === "slides") setPostMode("slides");
      if (draft.slides?.length) setSlides(draft.slides);
      setDraftRestored(true);
    } catch {
      // 파싱 실패 시 무시
    }
  }, [isEditMode, authChecked, userId]);

  // 견적 체크 → "익명 사례로 공유하기" prefill (이슈 #3)
  // - 인증 직후 1회 적용. 이후 사용자가 자유롭게 편집할 수 있도록 ref guard.
  const quotePrefillAppliedRef = useRef(false);
  useEffect(() => {
    if (isEditMode || !authChecked || !userId || quotePrefillAppliedRef.current) return;
    quotePrefillAppliedRef.current = true;
    const prefill = consumeQuotePostHandoff(userId);
    if (!prefill) return;
    setCategory(prefill.category);
    if (prefill.title) setTitle(prefill.title.slice(0, TITLE_MAX_LENGTH));
    if (prefill.body) setContent(prefill.body.slice(0, CONTENT_MAX_LENGTH));
    setDraftRestored(false);
  }, [isEditMode, authChecked, userId]);

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
      postMode,
      slides,
    });
    // 아무것도 입력하지 않은 빈 상태는 변경으로 취급하지 않음
    const isEmpty =
      !category &&
      !title &&
      !content &&
      images.length === 0 &&
      tags.length === 0 &&
      vendorTags.length === 0 &&
      slides.length === 0;
    if (isEmpty) {
      setHasUnsavedChanges(false);
    } else if (isEditMode) {
      setHasUnsavedChanges(currentForm !== initialFormRef.current);
    } else {
      setHasUnsavedChanges(true);
    }
  }, [category, title, content, visibility, images, tags, vendorTags, postMode, slides, isEditMode]);

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
    if (isEditMode || !userId) return;

    autoSaveRef.current = setInterval(() => {
      const draft: DraftData = {
        ownerId: userId,
        category,
        title,
        content,
        visibility,
        images,
        tags,
        vendorTags,
        adDisclosure,
        sponsorshipDetail: sponsorshipDetail || undefined,
        priceData,
        poll,
        inlineImages: inlineImages.length > 0 ? inlineImages : undefined,
        postMode,
        slides: slides.length > 0 ? slides : undefined,
        savedAt: Date.now(),
      };
      // 비어있으면 저장하지 않음 (카드 모드면 슬라이드 한 장만 있어도 저장)
      if (!title && !content && !category && slides.length === 0) return;
      try {
        localStorage.setItem(communityPostDraftKey(userId), JSON.stringify(draft));
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
  }, [isEditMode, userId, category, title, content, visibility, images, tags, vendorTags, adDisclosure, sponsorshipDetail, priceData, poll, inlineImages, postMode, slides]);

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

  // 유효성 검사 — 카드 모드면 본문 대신 슬라이드 1장 이상 필수
  const isValid =
    !!category &&
    title.trim().length > 0 &&
    (postMode === "slides"
      ? slides.length > 0
      : content.trim().length > 0);

  // 본문 인라인 이미지 삽입 — 커서 위치에 <img> 태그를 끼움
  const insertAtCursor = useCallback((snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((prev) => (prev + snippet).slice(0, CONTENT_MAX_LENGTH));
      return;
    }
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = (content.slice(0, start) + snippet + content.slice(end)).slice(
      0,
      CONTENT_MAX_LENGTH
    );
    setContent(next);
    // 커서를 삽입된 텍스트 뒤로 이동
    requestAnimationFrame(() => {
      ta.focus();
      const pos = Math.min(start + snippet.length, next.length);
      ta.setSelectionRange(pos, pos);
      autoResize();
    });
  }, [content, autoResize]);

  const handleInsertImage = useCallback(
    async (file: File) => {
      if (insertingImage) return;
      setInsertImageError(null);
      // 5MB 검증 (이미지), 10MB (GIF)
      const isGif = file.type === "image/gif";
      const max = isGif ? 6 * 1024 * 1024 : 5 * 1024 * 1024;
      if (!file.type.startsWith("image/")) {
        setInsertImageError("이미지/GIF 파일만 삽입할 수 있어요.");
        return;
      }
      if (file.size > max) {
        setInsertImageError(isGif ? "GIF는 6MB 이하" : "이미지는 5MB 이하");
        return;
      }
      setInsertingImage(true);
      try {
        const data = await uploadCommunityMedia(file);
        // 토큰만 textarea에 삽입 (raw HTML 보이는 것 방지). 발행/미리보기 때 HTML로 변환.
        const id = newInlineImageId();
        setInlineImages((prev) => [...prev, { id, url: data.url }]);
        insertAtCursor(`\n\n[!img:${id}]\n\n`);
      } catch (error) {
        setInsertImageError(error instanceof Error ? error.message : "업로드 중 오류가 발생했어요.");
      } finally {
        setInsertingImage(false);
        if (inlineImageInputRef.current) inlineImageInputRef.current.value = "";
      }
    },
    [insertingImage, insertAtCursor]
  );

  // 클립보드에서 이미지 붙여넣기
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.type.startsWith("image/"));
      if (!imageItem) return; // 일반 텍스트 paste는 기본 동작 유지
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      void handleInsertImage(file);
    },
    [handleInsertImage]
  );

  // 본문에 이미지 파일 drag & drop
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      e.preventDefault();
      setIsDraggingImage(true);
    }
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      e.preventDefault();
    }
  }, []);
  const handleDragLeave = useCallback(() => {
    setIsDraggingImage(false);
  }, []);
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const imageFile = files.find((f) => f.type.startsWith("image/"));
      if (!imageFile) {
        setIsDraggingImage(false);
        return;
      }
      e.preventDefault();
      setIsDraggingImage(false);
      void handleInsertImage(imageFile);
    },
    [handleInsertImage]
  );

  // 콘텐츠 미리보기 — 토큰을 <img>로 변환 후 sanitize. post detail과 동일한 출력.
  const renderPreviewHtml = useCallback(() => {
    return sanitizeHtml(tokensToHtml(content, inlineImages));
  }, [content, inlineImages]);

  // 제출
  const handleSubmit = async (asDraft = false) => {
    if (isSubmitting) return;
    if (!category || !title.trim()) {
      setError("카테고리와 제목을 입력해 주세요.");
      return;
    }
    if (postMode === "slides") {
      if (slides.length === 0) {
        setError("카드 게시물에는 이미지가 최소 1장 이상 필요해요.");
        return;
      }
    } else if (!content.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }

    // 폴 검증: 활성화되어 있다면 질문 + 옵션 2개 이상 필수
    if (poll) {
      const validOptions = poll.options.filter((o) => o.label.trim().length > 0);
      if (!poll.question.trim() || validOptions.length < 2) {
        setError("투표를 추가하려면 질문과 선택지를 2개 이상 입력해 주세요. (또는 투표를 제거해 주세요.)");
        return;
      }
    }
    if (adDisclosure === "sponsored" && sponsorshipDetail.trim().length < 5) {
      setError("협찬이 포함된 글은 받은 혜택을 5자 이상 적어주세요.");
      return;
    }

    const expectedUserId = userId;
    const expectedActorKey = actor.status === "ready" && actor.kind === "user"
      ? actor.actorKey
      : null;
    if (!expectedUserId || !expectedActorKey || actor.userId !== expectedUserId) {
      setError("계정이 변경되어 글 작성을 중단했어요. 다시 로그인해 주세요.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    // 폴은 수정 모드에서는 전송하지 않음 (재투표 결과 보존)
    const pollPayload =
      !isEditMode && poll && poll.options.filter((o) => o.label.trim().length > 0).length >= 2
        ? {
            ...poll,
            question: poll.question.trim(),
            options: poll.options
              .map((o) => ({ label: o.label.trim(), image_url: o.image_url ?? null }))
              .filter((o) => o.label.length > 0),
          }
        : null;

    // 발행 직전 토큰 → <img> HTML 변환 (저장 형식은 항상 HTML).
    // 카드 모드면 본문은 캡션이라 짧고 토큰도 없으니 sanitize만 따로 처리.
    const serializedContent =
      postMode === "slides"
        ? sanitizeHtml(content.trim() || "")
        : tokensToHtml(content.trim(), inlineImages);

    const input: CreatePostInput = {
      category,
      title: title.trim(),
      content: serializedContent,
      visibility: asDraft ? "draft" : visibility,
      // 카드 게시물은 슬라이드만 사용 — 별도 갤러리 이미지는 전송하지 않음
      images: postMode === "slides" ? [] : images,
      slides: postMode === "slides" ? slides : null,
      tags,
      vendor_tags: vendorTags,
      ad_disclosure: adDisclosure,
      sponsorship_detail: sponsorshipDetail || undefined,
      ...((category === "is_normal" || category === "tour_review" || category === "tips_v2") && priceData
        ? { price_data: priceData }
        : {}),
      ...(pollPayload ? { poll: pollPayload } : {}),
    };

    try {
      const outcome = await runWithExpectedCommunityActor({
        expectedActorKey,
        expectedUserId,
        getCurrentActor: getCurrentVerifiedUserScopedActor,
        getVerifiedUserId: async () => {
          const { data, error: authError } = await createClient().auth.getUser();
          return authError ? null : data.user?.id ?? null;
        },
        operation: async () => {
          if (isEditMode && editId) {
            const success = await updatePost(editId, input, expectedUserId);
            if (!success) {
              const storeErr = useCommunityStore.getState().errorMessage;
              throw new Error(storeErr || "수정에 실패했습니다.");
            }
            return { kind: "updated" as const, postId: editId };
          }

          const postId = await createPost(input, expectedUserId);
          if (!postId) {
            const storeErr = useCommunityStore.getState().errorMessage;
            throw new Error(storeErr || "작성에 실패했습니다.");
          }
          return { kind: "created" as const, postId, asDraft };
        },
      });
      removeCommunityPostDraft(localStorage, expectedUserId);
      setHasUnsavedChanges(false);
      if (outcome.kind === "updated") {
        router.push(communityPostPath(outcome.postId));
      } else if (outcome.asDraft) {
        router.push(weddingPath());
      } else {
        router.push(communityPostPath(outcome.postId));
      }
    } catch (err) {
      setError(
        err instanceof CommunityActorChangedError
          ? "계정이 변경되어 글 작성을 중단했어요. 현재 계정에서 다시 확인해 주세요."
          : err instanceof Error ? err.message : "오류가 발생했습니다."
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
      <div className="min-h-[60vh] flex items-center justify-center bg-[#fbf8f2]">
        <Loader2 className="w-8 h-8 text-[#36534E] animate-spin" />
      </div>
    );
  }

  // 수정 모드 글 로딩
  if (loadingPost) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-[#fbf8f2]">
        <Loader2 className="w-8 h-8 text-[#36534E] animate-spin" />
      </div>
    );
  }

  // 글자수 경고 색상
  const titleCountColor = title.length >= TITLE_MAX_LENGTH
    ? "text-red-500"
    : title.length >= TITLE_MAX_LENGTH * 0.9
      ? "text-amber-500"
      : "text-[#635b51]";

  const contentCountColor = content.length >= CONTENT_MAX_LENGTH
    ? "text-red-500"
    : content.length >= CONTENT_MAX_LENGTH * 0.9
      ? "text-amber-500"
      : "text-[#635b51]";

  return (
    <div className="min-h-screen bg-[#fbf8f2]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-32 sm:pb-12">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-7">
          <button
            type="button"
            onClick={handleCancel}
            className="p-2 text-[#635b51] hover:text-[#263832] hover:bg-[#f6efe5] rounded-lg transition-colors"
            aria-label="뒤로 가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-serif-kr text-2xl sm:text-[28px] font-light text-[#263832]">
            {isEditMode ? "글 수정" : "글쓰기"}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {draftRestored && !isEditMode && (
              <span className="text-sm text-[#36534E]">
                임시저장 복원됨
              </span>
            )}
            {/* 자동 저장 표시 */}
            {autoSaveFlash && (
              <span className="flex items-center gap-1 text-sm text-emerald-500 animate-pulse">
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

        {/* 모드 토글 — 일반 글 / 인스타 캐러셀(카드 게시물) */}
        <div className="mb-6 inline-flex bg-white border border-[#e5d8ca] rounded-full p-1 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
          <button
            type="button"
            onClick={() => setPostMode("regular")}
            className={`px-4 py-2 text-[13px] font-medium rounded-full transition-all ${
              postMode === "regular"
                ? "bg-[#36534E] text-white shadow-sm"
                : "text-[#635b51] hover:text-[#263832]"
            }`}
          >
            일반 글
          </button>
          <button
            type="button"
            onClick={() => setPostMode("slides")}
            className={`px-4 py-2 text-[13px] font-medium rounded-full transition-all ${
              postMode === "slides"
                ? "bg-[#36534E] text-white shadow-sm"
                : "text-[#635b51] hover:text-[#263832]"
            }`}
          >
            카드 게시물 (옆으로 넘기기)
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px] gap-5 xl:gap-6 items-start">
          {/* 메인 영역: 제목 + 본문 */}
          <div className="min-w-0 space-y-7">
            {/* 제목 */}
            <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <label className="block text-sm font-semibold text-[#263832] mb-2.5">
                제목 <span className="text-[#36534E]">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX_LENGTH))}
                placeholder="제목을 입력하세요"
                maxLength={TITLE_MAX_LENGTH}
                className="w-full px-4 py-3 text-base text-[#263832] bg-[#f6efe5] border border-[#e5d8ca] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors"
              />
              <p className={`mt-2 text-xs text-right ${titleCountColor}`}>
                {title.length.toLocaleString()} / {TITLE_MAX_LENGTH.toLocaleString()}자
              </p>
            </section>

            {/* 카드 게시물(인스타 캐러셀) 빌더 — 슬라이드 모드 전용 */}
            {postMode === "slides" && (
              <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <label className="block text-sm font-semibold text-[#263832] mb-3">
                  슬라이드 <span className="text-[#36534E]">*</span>
                </label>
                <SlideBuilder slides={slides} onChange={setSlides} max={10} />
              </section>
            )}

            {/* 작성/미리보기 탭 */}
            <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-[#263832]">
                  {postMode === "slides" ? (
                    <>캡션 <span className="text-[#928980] text-sm font-normal">(선택)</span></>
                  ) : (
                    <>내용 <span className="text-[#36534E]">*</span></>
                  )}
                </label>
                <div className="flex bg-[#e5d8ca] rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab("write")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-md transition-colors ${
                      activeTab === "write"
                        ? "bg-[#36534E] text-white shadow-sm"
                        : "text-[#635b51] hover:text-[#263832]"
                    }`}
                  >
                    <Pencil className="w-4 h-4" />
                    작성
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("preview")}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-md transition-colors ${
                      activeTab === "preview"
                        ? "bg-[#36534E] text-white shadow-sm"
                        : "text-[#635b51] hover:text-[#263832]"
                    }`}
                  >
                    <Eye className="w-4 h-4" />
                    미리보기
                  </button>
                </div>
              </div>

              {activeTab === "write" ? (
                <>
                  <div className="relative">
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => {
                        setContent(e.target.value.slice(0, CONTENT_MAX_LENGTH));
                        autoResize();
                      }}
                      onPaste={handlePaste}
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      placeholder={
                        postMode === "slides"
                          ? "이 카드 게시물의 캡션을 한 줄로 적어보세요. (선택)"
                          : "내용을 입력하세요. 이미지나 GIF를 본문 중간에 붙여넣거나 끌어 놓거나, 아래 버튼으로 삽입할 수 있어요."
                      }
                      maxLength={CONTENT_MAX_LENGTH}
                      className={`w-full px-4 py-3 text-base text-[#263832] bg-[#f6efe5] border rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors resize-none leading-relaxed min-h-[220px] ${
                        isDraggingImage
                          ? "border-[#36534E] ring-2 ring-[#36534E]/30 bg-white"
                          : "border-[#e5d8ca]"
                      }`}
                    />
                    {isDraggingImage && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-[#36534E]/8">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white shadow-md text-sm font-medium text-[#36534E]">
                          <ImagePlus className="w-4 h-4" />
                          여기에 놓아 본문에 삽입
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 인라인 도구바 — 이미지/GIF 삽입. 카드 모드는 캡션이라 도구바 숨김. */}
                  <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {postMode === "regular" && (
                        <>
                          <input
                            ref={inlineImageInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleInsertImage(f);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => inlineImageInputRef.current?.click()}
                            disabled={insertingImage}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[#36534E] bg-[#fbf8f2] border border-[#e5d8ca] rounded-lg hover:border-[#36534E] hover:bg-white transition-colors disabled:opacity-60"
                            title="본문 안 커서 위치에 이미지/GIF 삽입"
                          >
                            {insertingImage ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <ImagePlus className="w-4 h-4" />
                            )}
                            본문에 이미지/GIF 삽입
                          </button>
                          {insertImageError && (
                            <span className="text-xs text-red-500">{insertImageError}</span>
                          )}
                        </>
                      )}
                    </div>
                    <p className={`text-xs ${contentCountColor}`}>
                      {content.length.toLocaleString()} / {CONTENT_MAX_LENGTH.toLocaleString()}자
                    </p>
                  </div>

                  {/* 본문에 삽입된 이미지 썸네일 — 토큰이 어떤 이미지인지 시각 확인 + 제거. 카드 모드에서는 숨김. */}
                  {postMode === "regular" && inlineImages.length > 0 && (
                    <div className="mt-3 p-3 bg-[#fbf8f2] border border-[#f0eeec] rounded-lg">
                      <p className="text-xs font-medium text-[#928980] uppercase tracking-widest mb-2">
                        본문 안 이미지 {inlineImages.length}장
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {inlineImages.map((img, idx) => (
                          <div
                            key={img.id}
                            className="relative group w-20 h-20 rounded-lg overflow-hidden border border-[#e5d8ca] bg-white"
                            title={`[!img:${img.id}]`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={`인라인 이미지 ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                // 토큰을 본문에서 제거 (앞뒤 공백 줄바꿈도 정리) + 매핑에서도 제거
                                const tokenRe = new RegExp(
                                  `\\n*\\[!img:${img.id}\\]\\n*`,
                                  "g"
                                );
                                setContent((prev) => prev.replace(tokenRe, "\n\n"));
                                setInlineImages((prev) => prev.filter((i) => i.id !== img.id));
                              }}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                              aria-label={`이미지 ${idx + 1} 제거`}
                              title="제거"
                            >
                              ✕
                            </button>
                            <div className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/55 text-white text-[10px] font-medium">
                              {idx + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full px-4 py-3 bg-[#f6efe5] border border-[#e5d8ca] rounded-xl min-h-[220px]">
                  {content.trim() ? (
                    <div
                      className="prose prose-sm max-w-none text-[#263832] leading-relaxed whitespace-pre-wrap break-words"
                      dangerouslySetInnerHTML={{ __html: renderPreviewHtml() }}
                    />
                  ) : (
                    <p className="text-[#635b51] text-sm">미리볼 내용이 없습니다.</p>
                  )}
                </div>
              )}
            </section>

            {/* 이미지 업로드 — 일반 글 모드 전용 (카드 게시물은 SlideBuilder가 담당) */}
            {postMode === "regular" && (
              <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <label className="block text-sm font-semibold text-[#263832] mb-3">
                  이미지
                </label>
                <ImageUploader images={images} onChange={setImages} max={5} />
              </section>
            )}

            {/* 투표 (폴) — 수정 모드에서는 비활성화. 카드 게시물도 폴 없이 깔끔하게 유지. */}
            {!isEditMode && postMode === "regular" && (
              <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <PollEditor value={poll} onChange={setPoll} />
              </section>
            )}
          </div>

          {/* 사이드바 영역: 카테고리, 태그, 공개범위 등 메타 */}
          <div className="min-w-0 space-y-5 xl:space-y-6">
            {/* 카테고리 선택 */}
            <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <label className="block text-sm font-semibold text-[#263832] mb-3">
                카테고리 <span className="text-[#36534E]">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {COMMUNITY_CATEGORIES.map((cat) => {
                  const Icon = getIcon(cat.icon);
                  const isSelected = category === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setCategory(cat.key)}
                      className={`flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl border transition-all ${
                        isSelected
                          ? "border-[#36534E] bg-[#36534E] text-white shadow-sm"
                          : "border-[#e5d8ca] bg-white text-[#635b51] hover:border-[#36534E] hover:text-[#263832]"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 whitespace-nowrap">{cat.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 공개 범위 */}
            <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <label className="block text-sm font-semibold text-[#263832] mb-3">
                공개 범위
              </label>
              <div className="space-y-2">
                {[
                  { key: "public" as PostVisibility, label: "전체 공개", icon: Globe },
                  { key: "members" as PostVisibility, label: "회원 공개", icon: Users },
                ].map((opt) => {
                  const isSelected = visibility === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setVisibility(opt.key)}
                      className={`flex items-center gap-2 w-full px-3 py-2.5 text-sm font-medium rounded-xl border transition-all ${
                        isSelected
                          ? "border-[#36534E] bg-[#36534E] text-white shadow-sm"
                          : "border-[#e5d8ca] bg-white text-[#635b51] hover:border-[#36534E]"
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
            <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <label className="block text-sm font-semibold text-[#263832] mb-3">
                태그
              </label>
              <TagInput tags={tags} onChange={setTags} max={10} />
            </section>

            {/* 업체 태그 (카테고리가 허용하는 경우) */}
            {categoryInfo?.allowVendorTags && (
              <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <label className="block text-sm font-semibold text-[#263832] mb-3">
                  업체 태그
                </label>
                <VendorTagPicker vendorIds={vendorTags} onChange={setVendorTags} />
              </section>
            )}

            {/* 광고 표시 */}
            <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
              <label className="block text-sm font-semibold text-[#263832] mb-3">
                광고·협찬 포함 여부
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdDisclosure("general");
                    setSponsorshipDetail("");
                  }}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    adDisclosure === "general"
                      ? "border-[#36534E] bg-[#36534E] text-white"
                      : "border-[#e5d8ca] bg-white text-[#635b51] hover:border-[#36534E]"
                  }`}
                >
                  아니요
                </button>
                <button
                  type="button"
                  onClick={() => setAdDisclosure("sponsored")}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    adDisclosure !== "general"
                      ? "border-[#36534E] bg-[#f6efe5] text-[#36534E]"
                      : "border-[#e5d8ca] bg-white text-[#635b51] hover:border-[#36534E]"
                  }`}
                >
                  예
                </button>
              </div>
              {adDisclosure !== "general" && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: "sponsored" as AdDisclosure, label: "협찬" },
                      { key: "ad" as AdDisclosure, label: "광고" },
                    ].map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setAdDisclosure(option.key)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          adDisclosure === option.key
                            ? "border-[#36534E] bg-[#36534E] text-white"
                            : "border-[#e5d8ca] bg-white text-[#635b51] hover:border-[#36534E]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {adDisclosure === "sponsored" && (
                    <textarea
                      value={sponsorshipDetail}
                      onChange={(event) => setSponsorshipDetail(event.target.value)}
                      placeholder="받은 혜택을 적어주세요. 예: 드레스 피팅 1회 무료 제공"
                      rows={3}
                      className="w-full rounded-lg border border-[#e5d8ca] bg-[#FAFAF8] px-3 py-2 text-sm text-[#263832] outline-none focus:border-[#36534E]"
                    />
                  )}
                </div>
              )}
            </section>

            {/* 가격 정보 폼 — 가격이 오갈 수 있는 카테고리 전체에 노출 (아모라 시세 코멘트 트리거) */}
            {(category === "is_normal" || category === "tour_review" || category === "tips_v2") && (
              <section className="bg-white border border-transparent rounded-2xl p-5 sm:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                <label className="block text-sm font-semibold text-[#263832] mb-3">
                  {category === "is_normal" ? "가격 질문 (선택)" : "가격 정보 (선택)"}
                </label>
                <PriceQuestionForm onChange={setPriceData} />
              </section>
            )}
          </div>
        </div>

        {/* 하단 버튼 - 데스크탑 */}
        <div className="hidden sm:flex items-center justify-between gap-3 mt-10 pt-6 border-t border-[#e5d8ca]">
          <button
            type="button"
            onClick={handleCancel}
            className="px-6 py-2.5 text-sm font-medium text-[#635b51] bg-white border border-[#e5d8ca] rounded-xl hover:bg-[#f6efe5] transition-colors"
          >
            취소
          </button>
          <div className="flex items-center gap-3">
            {!isEditMode && (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting || !category || !title.trim()}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-[#635b51] bg-white border border-[#e5d8ca] rounded-xl hover:bg-[#f6efe5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="w-4 h-4" />
                임시저장
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting || !isValid}
              className="flex items-center justify-center gap-2 px-8 py-3 text-sm font-semibold text-white bg-[#36534E] rounded-xl hover:bg-[#2B423E] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_4px_14px_0_rgba(6,26,52,0.2)]"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : null}
              {isEditMode ? "수정하기" : "발행하기"}
            </button>
          </div>
        </div>

        {/* 하단 버튼 - 모바일 고정 — iPhone 홈 인디케이터(safe-area-inset-bottom) 보정 */}
        <div
          className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#e5d8ca] px-4 pt-3 flex items-center gap-2"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-[#635b51] bg-[#f6efe5] border border-[#e5d8ca] rounded-lg transition-colors"
          >
            취소
          </button>
          {!isEditMode && (
            <button
              type="button"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting || !category || !title.trim()}
              className="px-4 py-2 text-sm font-medium text-[#635b51] bg-[#f6efe5] border border-[#e5d8ca] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting || !isValid}
            className="flex-1 flex items-center justify-center gap-2 py-3 text-base font-medium text-white bg-[#36534E] rounded-lg hover:bg-[#2B423E] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_4px_14px_0_rgba(6,26,52,0.2)]"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            {isEditMode ? "수정하기" : "발행하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
