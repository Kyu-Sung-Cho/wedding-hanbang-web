"use client";

import Image from "next/image";

interface AvatarProps {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

/**
 * 커뮤니티 아바타 컴포넌트
 * - avatarUrl이 있으면 실제 이미지 표시
 * - 없으면 DiceBear API로 닉네임 기반 캐릭터 자동 생성
 * - 같은 닉네임은 항상 같은 캐릭터 (seed 고정)
 */
export default function Avatar({
  nickname,
  avatarUrl,
  size = 40,
  className = "",
}: AvatarProps) {
  // 사용자가 올린 프로필 사진 우선
  if (avatarUrl && !isEmoji(avatarUrl) && (avatarUrl.startsWith("http") || avatarUrl.startsWith("/"))) {
    return (
      <div
        className={`rounded-full overflow-hidden bg-[#f6f3f2] ${className}`}
        style={{ width: size, height: size }}
      >
        <Image
          src={avatarUrl}
          alt={nickname}
          width={size}
          height={size}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  // 이모지 아바타가 있으면 그대로 표시
  if (avatarUrl && isEmoji(avatarUrl)) {
    return (
      <div
        className={`rounded-full bg-gradient-to-br from-[#f6f3f2] to-[#e4e2e1] flex items-center justify-center ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        {avatarUrl}
      </div>
    );
  }

  // DiceBear 자동 아바타 (notionists 스타일: 깔끔한 일러스트)
  // seed로 닉네임 사용 → 같은 닉네임은 항상 같은 얼굴
  const seed = encodeURIComponent(nickname || "anonymous");
  const dicebearUrl = `https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&backgroundColor=fcf9f8,f6f3f2,e4e2e1&radius=50`;

  return (
    <div
      className={`rounded-full overflow-hidden bg-gradient-to-br from-[#f6f3f2] to-[#e4e2e1] ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dicebearUrl}
        alt={nickname}
        width={size}
        height={size}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}

function isEmoji(str: string): boolean {
  // 이모지 유니코드 감지 (간단 버전)
  return /\p{Emoji}/u.test(str) && str.length <= 4;
}
