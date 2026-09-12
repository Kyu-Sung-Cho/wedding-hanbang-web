"use client";

import ProfileAvatar from "@/components/ui/ProfileAvatar";
import type { UserRole } from "@/types/database.types";

interface AvatarProps {
  nickname: string;
  avatarUrl?: string | null;
  role?: UserRole | null;
  size?: number;
  className?: string;
}

// 공개 커뮤니티의 이름과 아바타만 받는다. 웨딩 프로필이나 성별로 보완하지 않는다.
export default function Avatar({ nickname, avatarUrl, size = 40, className = "" }: AvatarProps) {
  return <ProfileAvatar name={nickname || "익명"} avatarUrl={avatarUrl} size={size} className={className} />;
}
