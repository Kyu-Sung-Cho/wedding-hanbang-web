"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import ImageUploader from "@/components/community/ImageUploader";
import AdDisclosureModal, { type AdDisclosureChoice } from "@/components/community/AdDisclosureModal";
import { useToast } from "@/components/community/Toast";
import { COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import { communityPostPath } from "@/lib/community/routes";
import { isCommunityMediaPublishingUiEnabled } from "@/lib/community/mediaPublishingUiGate";
import { useAuthStore } from "@/stores/authStore";
import {
  QUICK_REVIEW_CONNECTION_LOST_MESSAGE,
  QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE,
  QUICK_REVIEW_RECEIPT_MISSING_MESSAGE,
  createQuickReviewSubmission,
  quickReviewFailureMessage,
  readCreatedQuickReviewPostId,
  validateQuickReviewDraft,
} from "./quickReviewSubmission";

// 로그인이 필요한 화면인데 제출 직후에야 401을 맞으면 다 쓴 후기가 헛수고가 된다.
// 미리 알려주고, 로그인 뒤 이 자리로 돌아오게 한다.
const QUICK_REVIEW_LOGIN_HREF = "/login?redirect=%2Fwedding%2Fcommunity%2Fquick-review";
const MEDIA_PUBLISHING_UI_ENABLED = isCommunityMediaPublishingUiEnabled(
  process.env.NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED,
);

type Category = (typeof COHORT_CONTRACT_CATEGORIES)[number]["key"];

export default function QuickReviewPage() {
  const router = useRouter();
  const { toast } = useToast();
  const profile = useAuthStore((state) => state.profile);

  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState<Category>("studio");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [oneLiner, setOneLiner] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  // 실패 뒤 같은 내용으로 다시 보내면 같은 요청 키를 쓴다. 응답만 잃고 저장된 경우
  // 서버가 저장된 글을 돌려주므로 같은 후기가 두 번 생기지 않는다. 키는 이 화면이 떠 있는
  // 동안만 있다. 새로고침하거나 로그인하러 다녀오면 없으므로, 쓴 내용도 남기지 않는다.
  const [submission] = useState(() =>
    createQuickReviewSubmission(() => globalThis.crypto.randomUUID()),
  );
  // 실패한 요청에서 고른 광고 표시와 협찬 내용. 다시 열 때 모달에 채워 둔다. 모달이 비어
  // 열리면 협찬 내용을 다시 적어야 하고, 한 글자만 달라도 새 요청 키가 붙어 응답만 잃은
  // 첫 요청과 함께 협찬 후기가 두 개 생긴다. 저장에 성공하면 요청 키와 함께 버린다.
  const [lastAdChoice, setLastAdChoice] = useState<AdDisclosureChoice | null>(null);

  const inputCls =
    "w-full px-4 py-3 border border-[#F0EFED] rounded-[6px] focus:border-[var(--hb-primary)] focus:outline-none text-base";

  function handleSubmitClick(e: React.FormEvent) {
    e.preventDefault();
    const err = validateQuickReviewDraft({
      vendorName,
      category,
      rating,
      review: oneLiner,
      images: [],
    });
    if (err) {
      toast.error(err);
      return;
    }
    setShowAdModal(true);
  }

  async function handleAdSelect(result: AdDisclosureChoice) {
    setShowAdModal(false);
    if (submitting) return;
    const draft = {
      vendorName,
      category,
      rating,
      review: oneLiner,
      images: MEDIA_PUBLISHING_UI_ENABLED ? images : [],
      adDisclosure: result.adDisclosure,
      sponsorshipDetail: result.sponsorshipDetail,
    };
    const err = validateQuickReviewDraft(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const { idempotencyKey, body } = submission.commandFor(draft);
      // 아래 어느 갈래로 실패하든 다시 열 때 같은 선택이 채워져 있어야 한다.
      setLastAdChoice(result);
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      });
      // 게이트웨이 오류 페이지처럼 JSON 이 아닌 응답도 있다.
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 401) {
        // 로그인하러 다녀오면 이 화면은 새로 뜨고 쓴 내용은 남지 않는다. 이어서 올릴 수 있다고 말하지 않는다.
        toast.error(QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE);
        router.push(QUICK_REVIEW_LOGIN_HREF);
        return;
      }
      if (!res.ok) {
        toast.error(quickReviewFailureMessage(data));
        return;
      }
      // 새 글 id 를 확인한 뒤에만 등록된 것으로 본다. 저장됐을 수 있으니 요청 키는 남긴다.
      const postId = readCreatedQuickReviewPostId(data);
      if (!postId) {
        toast.error(QUICK_REVIEW_RECEIPT_MISSING_MESSAGE);
        return;
      }
      submission.clear();
      setLastAdChoice(null);
      toast.success("15초 후기가 등록되었어요.");
      router.push(communityPostPath(postId));
    } catch {
      // fetch 가 거절됐다(연결이 끊김). 브라우저의 영어 오류 대신, 이 화면에서 그대로 다시
      // 보내도 두 번 올라가지 않는다고만 말한다.
      toast.error(QUICK_REVIEW_CONNECTION_LOST_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
      <h1
        className="font-serif text-[var(--hb-text-strong)] mb-2"
        style={{ fontFamily: "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif" }}
      >
        15초 후기
      </h1>
      <p className="text-[var(--hb-text-muted)] mb-8 text-sm">
        투어 끝나고 차 안에서 끝낼 수 있어요.
      </p>

      {!profile ? (
        <div className="mb-6 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-4">
          <p className="text-sm font-semibold text-[var(--hb-text-strong)]">후기를 올리려면 로그인이 필요해요</p>
          <p className="mt-1 text-sm leading-6 text-[var(--hb-text-strong)]/70">
            먼저 로그인해두면 다 쓰고 나서 다시 쓰는 일이 없어요. 닉네임은 익명으로 시작하고, 실명은 공개되지 않아요.
          </p>
          <Link
            href={QUICK_REVIEW_LOGIN_HREF}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-semibold text-white"
          >
            로그인하고 쓰기
          </Link>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmitClick}
        className="bg-white border border-[#F0EFED] rounded-[6px] p-6 sm:p-8 space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-[var(--hb-text-strong)] mb-2">
            업체명
          </label>
          <input
            type="text"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="예: 라벨르 스튜디오"
            className={inputCls}
            maxLength={60}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--hb-text-strong)] mb-2">
            카테고리
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className={inputCls}
          >
            {COHORT_CONTRACT_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--hb-text-strong)] mb-2">별점</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = (hoverRating || rating) >= n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1"
                  aria-label={`${n}점`}
                >
                  <Star
                    className={`w-8 h-8 transition ${
                      active ? "text-[var(--color-paper-tape-ink)]" : "text-[var(--color-paper-outline)]"
                    }`}
                    fill={active ? "currentColor" : "none"}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {MEDIA_PUBLISHING_UI_ENABLED && (
        <div>
          <label className="block text-sm font-medium text-[var(--hb-text-strong)] mb-2">
            사진 (최대 3장)
          </label>
          <ImageUploader images={images} onChange={setImages} max={3} />
        </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--hb-text-strong)] mb-2">
            한 줄 후기 <span className="text-[var(--hb-text-muted)] text-xs">({oneLiner.length}/100)</span>
          </label>
          <input
            type="text"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value.slice(0, 100))}
            placeholder="실장님이 친절해요. 드레스 종류도 많고..."
            className={inputCls}
            maxLength={100}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-[var(--hb-primary)] text-white rounded-[6px] py-3 px-6 font-medium shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] transition-all disabled:opacity-60"
        >
          {submitting ? "등록 중..." : "후기 등록"}
        </button>
      </form>

      {showAdModal && <AdDisclosureModal onSelect={handleAdSelect} initialChoice={lastAdChoice} />}
    </div>
  );
}
