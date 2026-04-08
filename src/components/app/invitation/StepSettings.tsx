"use client";

import { useState } from "react";
import { useInvitationStore } from "@/stores/invitationStore";
import type { OpeningAnimation } from "@/types/invitation.types";
import { Globe, Copy, Check, ExternalLink } from "lucide-react";

const ANIMATIONS: { key: OpeningAnimation; label: string }[] = [
  { key: "fadeIn", label: "페이드 인" },
  { key: "slideUp", label: "슬라이드 업" },
  { key: "zoomIn", label: "줌 인" },
  { key: "curtainOpen", label: "커튼 오픈" },
  { key: "sparkle", label: "스파클" },
  { key: "heartBeat", label: "하트비트" },
  { key: "typewriter", label: "타이프라이터" },
  { key: "glitch", label: "글리치" },
  { key: "morphing", label: "모핑" },
  { key: "leafFall", label: "나뭇잎" },
  { key: "floatUp", label: "플로트 업" },
  { key: "petalFall", label: "꽃잎" },
  { key: "waveSlide", label: "웨이브" },
  { key: "snowFall", label: "눈내림" },
  { key: "filmRoll", label: "필름 롤" },
  { key: "pageFlip", label: "페이지 넘김" },
  { key: "waterDrop", label: "물방울" },
  { key: "letterOpen", label: "편지 열기" },
  { key: "confetti", label: "컨페티" },
  { key: "ripple", label: "리플" },
  { key: "spiralIn", label: "나선" },
  { key: "blindsOpen", label: "블라인드" },
  { key: "fadeScale", label: "페이드 스케일" },
  { key: "slideRotate", label: "슬라이드 회전" },
  { key: "bounceIn", label: "바운스" },
  { key: "flipCard", label: "카드 뒤집기" },
  { key: "doorOpen", label: "문 열기" },
  { key: "curtainReveal", label: "커튼 리빌" },
  { key: "lightReveal", label: "라이트 리빌" },
  { key: "parallaxZoom", label: "패럴랙스 줌" },
];

export default function StepSettings() {
  const { current, updateCurrent, publishInvitation, updateInvitation, editorDirty } = useInvitationStore();
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);

  if (!current) return null;

  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${current.slug}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePublish = async () => {
    setPublishing(true);
    if (editorDirty) {
      await updateInvitation(current.id, current);
    }
    await publishInvitation(current.id);
    setPublishing(false);
  };

  return (
    <div>
      <h2 className="text-[25px] font-medium text-noir-800 mb-1">설정 & 발행</h2>
      <p className="text-[25px] text-taupe-500 mb-6">마지막 설정을 확인하고 청첩장을 발행하세요.</p>

      {/* 오프닝 애니메이션 */}
      <div className="mb-6">
        <label className="block text-[38px] font-medium text-taupe-500 mb-2">오프닝 애니메이션</label>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {ANIMATIONS.map((anim) => (
            <button
              key={anim.key}
              onClick={() => updateCurrent({ opening_animation: anim.key })}
              className={`px-2 py-2 rounded-lg text-[23px] font-medium transition-colors ${
                current.opening_animation === anim.key
                  ? "bg-noir-800 text-white"
                  : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
              }`}
            >
              {anim.label}
            </button>
          ))}
        </div>
      </div>

      {/* 기능 토글 */}
      <div className="mb-6 flex flex-col gap-3">
        <label className="block text-[38px] font-medium text-taupe-500 mb-1">기능 설정</label>
        {[
          { key: "gallery_enabled", label: "갤러리" },
          { key: "location_enabled", label: "오시는 길 (위치)" },
          { key: "rsvp_enabled", label: "참석 여부 (RSVP)" },
          { key: "guestbook_enabled", label: "방명록" },
          { key: "account_enabled", label: "축의금 계좌 표시" },
        ].map((toggle) => (
          <label key={toggle.key} className="flex items-center justify-between p-3 bg-ivory-50 rounded-xl cursor-pointer">
            <span className="text-[25px] text-noir-800">{toggle.label}</span>
            <div
              onClick={() => updateCurrent({ [toggle.key]: !current[toggle.key as keyof typeof current] })}
              className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                current[toggle.key as keyof typeof current] ? "bg-rose-500" : "bg-taupe-400/30"
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${
                  current[toggle.key as keyof typeof current] ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </div>
          </label>
        ))}
      </div>

      {/* 배경음악 URL */}
      <div className="mb-6">
        <label className="block text-[38px] font-medium text-taupe-500 mb-1.5">배경 음악 URL (선택)</label>
        <input
          type="url"
          value={current.background_music_url ?? ""}
          onChange={(e) => updateCurrent({ background_music_url: e.target.value || null })}
          placeholder="https://..."
          className="w-full px-4 py-2.5 rounded-xl border border-black/[0.06] text-[23px] text-noir-800 placeholder:text-taupe-400 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
        />
      </div>

      {/* 발행/공유 */}
      <div className="p-5 bg-ivory-50 rounded-xl border border-black/[0.06]">
        {current.is_published ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-green-500" />
              <span className="text-[23px] font-medium text-green-600">발행됨</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-[38px] text-taupe-500"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-noir-800 text-white rounded-lg text-[38px] font-medium flex items-center gap-1"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "복사됨" : "복사"}
              </button>
              <a
                href={shareUrl}
                target="_blank"
                className="px-3 py-2 bg-rose-500 text-white rounded-lg text-[38px] font-medium flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                보기
              </a>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <Globe className="w-8 h-8 text-taupe-400 mx-auto mb-2" />
            <p className="text-[25px] text-taupe-500 mb-4">
              청첩장을 발행하면 링크를 통해 누구나 볼 수 있습니다.
            </p>
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-8 py-3 bg-rose-500 text-white rounded-xl text-[23px] font-medium hover:bg-rose-600 disabled:opacity-50 transition-colors"
            >
              {publishing ? "발행 중..." : "청첩장 발행하기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
