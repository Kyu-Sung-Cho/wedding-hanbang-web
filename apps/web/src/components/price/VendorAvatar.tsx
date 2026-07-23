"use client";

import { useEffect, useRef, useState } from "react";

import { VendorMonogram } from "./VendorMonogram";

// 업체 아바타: 자가 호스팅 로고(vendor-images/logos/{id}.png) 우선, 없으면 모노그램.
// 로고는 핫링크가 아니라 스토리지 사본이라 외부 변경·만료에 흔들리지 않고,
// 미수집 업체는 404 → onError 폴백으로 항상 정갈한 모노그램이 보인다.
const STORAGE_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/vendor-images/logos`
  : null;

export function VendorAvatar({
  id,
  name,
  size = "md",
}: {
  id: string;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // SSR로 그려진 <img>가 하이드레이션 전에 실패하면 onError 이벤트를 놓친다 —
  // 마운트 시점에 완료·실패 상태를 직접 검사해 깨진 아이콘이 남지 않게 한다.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  if (!STORAGE_BASE || failed) return <VendorMonogram id={id} name={name} size={size} />;
  const sizeClass = size === "lg" ? "size-14" : size === "sm" ? "size-8" : "size-10";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 폴백 제어를 위한 원시 img (사이즈 고정이라 CLS 없음)
    <img
      ref={imgRef}
      src={`${STORAGE_BASE}/${id}.png`}
      alt=""
      aria-hidden="true"
      width={size === "lg" ? 56 : size === "sm" ? 32 : 40}
      height={size === "lg" ? 56 : size === "sm" ? 32 : 40}
      loading="lazy"
      onError={() => setFailed(true)}
      // 아이보리 배경 + 여백: 흰색·투명 로고도 실종되지 않는다.
      className={`${sizeClass} shrink-0 select-none rounded-2xl border border-[#243832]/10 bg-[#F7F1E8] object-contain p-1`}
    />
  );
}
