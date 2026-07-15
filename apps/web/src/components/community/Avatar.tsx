"use client";

import { useId } from "react";
import { normalizeCommunityAvatar } from "@/lib/community/avatar";

interface AvatarProps {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

const PALETTES = [
  { top: "#FDFCFA", bottom: "#E5D8CA", hair: "#1A1A1F", outfit: "#36534E", accent: "#C4967E", skin: "#F2C9B3" },
  { top: "#FAF8F5", bottom: "#DEE6C4", hair: "#2B241F", outfit: "#635B51", accent: "#C9A96E", skin: "#E7B99E" },
  { top: "#F5F2ED", bottom: "#DCE6E1", hair: "#41352D", outfit: "#36534E", accent: "#9A6B62", skin: "#D8A084" },
];

export default function Avatar({ nickname, avatarUrl, size = 40, className = "" }: AvatarProps) {
  const emoji = normalizeCommunityAvatar(avatarUrl);
  const safeNickname = nickname.trim() || "커뮤니티 사용자";
  const palette = PALETTES[hashString(safeNickname) % PALETTES.length];
  const gradientId = useId().replace(/:/g, "");

  if (emoji) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-gradient-to-br from-[#f6efe5] to-[#e5d8ca] ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        role="img"
        aria-label={`${safeNickname} 아바타`}
      >
        {emoji}
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-full bg-[#f6efe5] ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" role="img" aria-label={`${safeNickname} 아바타`} width={size} height={size} className="h-full w-full">
        <defs>
          <linearGradient id={`${gradientId}-bg`} x1="10" y1="8" x2="56" y2="58">
            <stop offset="0%" stopColor={palette.top} />
            <stop offset="100%" stopColor={palette.bottom} />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill={`url(#${gradientId}-bg)`} />
        <circle cx="32" cy="27" r="13" fill={palette.skin} />
        <path d="M20 27c2-9 8-14 16-14 6 0 10 4 10 11-8 0-15-2-21-6-1 4-3 7-5 9z" fill={palette.hair} />
        <path d="M19 55c3-8 7.4-12 13-12s10 4 13 12H19z" fill={palette.outfit} />
        <circle cx="27" cy="29" r="1.6" fill="#1A1A1F" />
        <circle cx="37" cy="29" r="1.6" fill="#1A1A1F" />
        <path d="M28.5 38c2.1 1.6 4.9 1.6 7 0" fill="none" stroke="#7A4F45" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="46" cy="19" r="2" fill={palette.accent} opacity="0.85" />
        <circle cx="32" cy="49" r="7.5" fill="#FFFFFF" opacity="0.18" />
        <text x="32" y="53" textAnchor="middle" fontSize="11" fontWeight="700" fill="#FFFFFF" opacity="0.82">
          {safeNickname.charAt(0).toUpperCase()}
        </text>
      </svg>
    </div>
  );
}
