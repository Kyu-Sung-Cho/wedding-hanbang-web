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

/** 닉네임이 없을 때 서버·화면이 채워 넣는 대체 문구. 이름이 아니므로 머리글자를 뽑지 않는다. */
const ANONYMOUS_NICKNAME = "익명";

// 공개 커뮤니티의 이름과 아바타만 받는다. 웨딩 프로필이나 성별로 보완하지 않는다.
// 이름 없는 계정은 다른 화면과 같은 사람 모양 아이콘으로 그린다(「익」이 아니다).
export default function Avatar({ nickname, avatarUrl, size = 40, className = "" }: AvatarProps) {
  const trimmed = nickname?.trim() ?? "";
  const realName = trimmed && trimmed !== ANONYMOUS_NICKNAME ? trimmed : null;
  return <ProfileAvatar name={realName} label={trimmed || ANONYMOUS_NICKNAME} avatarUrl={avatarUrl} size={size} className={className} />;
}
