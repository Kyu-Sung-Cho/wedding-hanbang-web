"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import ImageUploader from "@/components/community/ImageUploader";
import AdDisclosureModal from "@/components/community/AdDisclosureModal";
import { useToast } from "@/components/community/Toast";
import { COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import type { AdDisclosure } from "@/types/community.types";

type Category = (typeof COHORT_CONTRACT_CATEGORIES)[number]["key"];

export default function QuickReviewPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState<Category>("studio");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [oneLiner, setOneLiner] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);

  const inputCls =
    "w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none text-base";

  function validate(): string | null {
    if (!vendorName.trim()) return "업체명을 입력해주세요.";
    if (rating < 1) return "별점을 선택해주세요.";
    if (!oneLiner.trim()) return "한 줄 후기를 입력해주세요.";
    return null;
  }

  function handleSubmitClick(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setShowAdModal(true);
  }

  async function handleAdSelect(result: {
    adDisclosure: AdDisclosure;
    sponsorshipDetail?: string;
  }) {
    setShowAdModal(false);
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "tour_review",
          title: `${vendorName.trim()} 후기`,
          content: oneLiner.trim(),
          images,
          visibility: "public",
          vendor_tags: [vendorName.trim()],
          tags: [category],
          is_quick_review: true,
          rating,
          ad_disclosure: result.adDisclosure,
          sponsorship_detail: result.sponsorshipDetail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "작성에 실패했습니다.");
      toast.success("15초 후기가 등록되었어요.");
      router.push(`/community/post/${data.post.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10">
      <h1
        className="font-serif text-3xl font-medium text-[#1A1A1F] mb-2"
        style={{ fontFamily: "'Noto Serif KR', serif" }}
      >
        15초 후기
      </h1>
      <p className="text-[#878680] mb-8 text-sm">
        투어 끝나고 차 안에서 끝낼 수 있어요.
      </p>

      <form
        onSubmit={handleSubmitClick}
        className="bg-white border border-[#F0EFED] rounded-2xl p-6 sm:p-8 space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
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
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
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
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">별점</label>
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
                      active ? "text-[#C9A96E]" : "text-[#F0EFED]"
                    }`}
                    fill={active ? "#C9A96E" : "none"}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            사진 (최대 3장)
          </label>
          <ImageUploader images={images} onChange={setImages} max={3} />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A1A1F] mb-2">
            한 줄 후기 <span className="text-[#B5ADA3] text-xs">({oneLiner.length}/100)</span>
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
          className="w-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-xl py-3 px-6 font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all disabled:opacity-60"
        >
          {submitting ? "등록 중..." : "후기 등록"}
        </button>
      </form>

      {showAdModal && <AdDisclosureModal onSelect={handleAdSelect} />}
    </div>
  );
}
