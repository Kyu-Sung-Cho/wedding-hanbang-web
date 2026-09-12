"use client";

import { useState } from "react";
import { getProfileInitial, isProfileAvatarEmoji } from "@hanbang/shared/profile-avatar";

interface ProfileAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  /** 사용자가 고른 로컬 파일의 미리보기만 받는다. 저장된 값으로 사용하지 않는다. */
  previewUrl?: string | null;
  size?: number;
  className?: string;
}

const sizeClasses: Record<number, string> = {
  20: "size-5 text-[10px]", 24: "size-6 text-xs", 28: "size-7 text-sm",
  32: "size-8 text-sm", 34: "size-[34px] text-sm", 36: "size-9 text-base",
  40: "size-10 text-lg", 44: "size-11 text-lg", 48: "size-12 text-xl",
  56: "size-14 text-[24px]", 64: "size-16 text-[30px]", 80: "size-20 text-[32px]",
};

function imageSource(value?: string | null): string | null {
  if (!value || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

export default function ProfileAvatar({ name, avatarUrl, previewUrl, size = 40, className = "" }: ProfileAvatarProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = previewUrl?.startsWith("blob:") ? previewUrl : imageSource(avatarUrl);
  // 기존 공개 커뮤니티에 저장한 단일 이모지도 유지한다. 숫자와 URL은 이모지로 보지 않는다.
  const emoji = isProfileAvatarEmoji(avatarUrl) || (typeof avatarUrl === "string"
    && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(avatarUrl)
    && getProfileInitial(avatarUrl) === avatarUrl) ? avatarUrl : null;

  return (
    <span
      role="img"
      aria-label={`${name?.trim() || "사용자"} 프로필`}
      data-profile-avatar={source && source !== failedSource ? "photo" : emoji ? "emoji" : "initial"}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#D2B4AA] bg-[#EADDD8] font-sans font-semibold leading-none text-[#7D5753] ${sizeClasses[size] ?? sizeClasses[40]} ${className}`}
    >
      {source && source !== failedSource ? (
        // 인증된 개인 사진은 Next 이미지 최적화 프록시를 거치지 않고 쿠키와 함께 요청한다.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="" className="h-full! w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailedSource(source)} />
      ) : <span aria-hidden="true">{emoji || getProfileInitial(name)}</span>}
    </span>
  );
}
