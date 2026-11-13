"use client";

import { createContext, useContext } from "react";

/**
 * 아모라를 지금 보는 화면 옆에 여는 자리.
 *
 * ## 왜 있는가 (2026-11-13 파운더 결정)
 *
 * 파운더 원문(철자를 고치지 않았다): "메인 두개만 남길거야 아모라랑 웨딩 대쉬보드( 모든 것을 한
 * 페이지에 볼 수 잇는 웨딩라운지) 거게서도 아모라를 열수도 잇어 그 페이지에서 그럼 대쉬보드가 일단
 * 옆으로 밀리고 반정도가 아모라를 차는거지 혹은 뭐 1/3정도".
 *
 * 예전 옆 패널은 400px 짜리 덮개였다. 화면 위에 떠서 라운지를 가렸다. 이제 큰 화면에서는 아모라가
 * 라운지를 덮지 않고 옆자리를 차지한다. 라운지는 옆으로 밀려 계속 보인다. 너비는 본문 칸의 1/3 에서
 * 1/2 사이이고, 사람이 끌거나 버튼으로 정한다. 작은 화면에는 나란히 놓을 자리가 없어 예전처럼 위에
 * 덮는다.
 */

export interface AmoraPanelDraft {
  /** 같은 질문을 다시 들고 와도 다시 넣도록, 열 때마다 새로 받는 번호. */
  id: number;
  text: string;
}

export interface AmoraOpenOptions {
  /** 입력칸에 미리 넣을 질문. 보내지는 않는다. 보내는 것은 사람이다. */
  prefill?: string;
}

export interface AmoraDockApi {
  isOpen: boolean;
  /** 큰 화면이라 옆자리로 열리는가. 아니면 화면 위에 덮개로 열린다. */
  docked: boolean;
  open(options?: AmoraOpenOptions): void;
  close(): void;
  toggle(): void;
}

export const AmoraDockContext = createContext<AmoraDockApi | null>(null);

/** 아모라를 옆에 열 수 없는 화면(아모라 전체 화면과 그 아래 화면)에서는 null 이다. */
export function useAmoraDock(): AmoraDockApi | null {
  return useContext(AmoraDockContext);
}

/** 링크 클릭 가운데 브라우저에 맡길 것(새 탭·새 창)을 가려내는 데 필요한 값만. */
export interface AmoraLinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/**
 * 아모라로 가는 링크를 누르면 이동하지 않고 그 자리에서 아모라를 연다. 열었으면 true.
 *
 * 라운지의 아모라 입구는 단추가 아니라 링크로 둔다. 링크 주소(`/chat`)는 새 탭으로 열 때와 옆자리가 없는
 * 화면에서 그대로 쓰이고, 손으로 만든 단추를 늘리지 않는다(`rawButtonRatchet.test.ts`). 보조 키를 누른
 * 클릭과 가운데 단추는 사람이 새 탭을 고른 것이라 브라우저에 맡긴다.
 */
export function openAmoraInsteadOfLink(
  event: AmoraLinkClick,
  dock: AmoraDockApi | null,
  options?: AmoraOpenOptions,
): boolean {
  if (!dock || event.defaultPrevented) return false;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  dock.open(options);
  return true;
}

/**
 * Tailwind `xl`(80rem = 1280px). 이보다 좁으면 사이드바 220px 를 빼고 남는 칸에 본문과 아모라를
 * 나란히 놓을 자리가 모자라 덮개로 연다.
 */
export const AMORA_DOCK_MEDIA_QUERY = "(min-width: 80rem)";

export const AMORA_DOCK_RATIO_MIN = 1 / 3;
export const AMORA_DOCK_RATIO_MAX = 1 / 2;
/** 파운더가 먼저 말한 값("반정도"). 버튼 한 번으로 1/3 이 된다. */
export const AMORA_DOCK_RATIO_DEFAULT = AMORA_DOCK_RATIO_MAX;
/** 키보드 화살표 한 번에 움직이는 양. 1/3 과 1/2 사이를 네 번에 건넌다. */
export const AMORA_DOCK_RATIO_STEP = 1 / 24;
/** 이만큼 가까이 놓으면 1/3 이나 1/2 에 붙인다. */
const AMORA_DOCK_SNAP_DISTANCE = 0.025;
export const AMORA_DOCK_RATIO_STORAGE_KEY = "hanbang:amora-dock-ratio:v1";
/** 라운지가 넘기는 질문의 길이 상한. 전체 화면의 주소 prefill 상한보다 훨씬 작게 둔다. */
export const AMORA_PREFILL_MAX_LENGTH = 2_000;

export function clampAmoraDockRatio(value: number): number {
  if (!Number.isFinite(value)) return AMORA_DOCK_RATIO_DEFAULT;
  return Math.min(AMORA_DOCK_RATIO_MAX, Math.max(AMORA_DOCK_RATIO_MIN, value));
}

/** 1/3 이나 1/2 근처에서 손을 떼면 그 값에 붙인다. */
export function snapAmoraDockRatio(value: number): number {
  const clamped = clampAmoraDockRatio(value);
  for (const anchor of [AMORA_DOCK_RATIO_MIN, AMORA_DOCK_RATIO_MAX]) {
    if (Math.abs(clamped - anchor) <= AMORA_DOCK_SNAP_DISTANCE) return anchor;
  }
  return clamped;
}

/** 넓게 보기·좁게 보기 버튼이 가는 곳. 1/2 쪽에 가까우면 1/3 으로, 아니면 1/2 로. */
export function nextAmoraDockToggleRatio(value: number): number {
  const midpoint = (AMORA_DOCK_RATIO_MIN + AMORA_DOCK_RATIO_MAX) / 2;
  return clampAmoraDockRatio(value) >= midpoint ? AMORA_DOCK_RATIO_MIN : AMORA_DOCK_RATIO_MAX;
}

export function isWideAmoraDockRatio(value: number): boolean {
  return nextAmoraDockToggleRatio(value) === AMORA_DOCK_RATIO_MIN;
}

/** 손잡이를 놓은 자리에서 아모라 몫을 잰다. 아모라는 줄의 오른쪽 끝에 붙어 있다. */
export function amoraDockRatioFromPointer(input: {
  rowLeft: number;
  rowWidth: number;
  clientX: number;
}): number {
  if (!(input.rowWidth > 0)) return AMORA_DOCK_RATIO_DEFAULT;
  const rowRight = input.rowLeft + input.rowWidth;
  return clampAmoraDockRatio((rowRight - input.clientX) / input.rowWidth);
}

type RatioStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): RatioStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 저장소를 막은 브라우저는 접근만으로 예외를 낸다.
    return null;
  }
}

/** 이 브라우저에서 마지막으로 고른 너비. 못 읽거나 이상한 값이면 기본값. */
export function readAmoraDockRatio(storage: RatioStorage | null = defaultStorage()): number {
  if (!storage) return AMORA_DOCK_RATIO_DEFAULT;
  try {
    const raw = storage.getItem(AMORA_DOCK_RATIO_STORAGE_KEY);
    if (raw === null) return AMORA_DOCK_RATIO_DEFAULT;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? clampAmoraDockRatio(parsed) : AMORA_DOCK_RATIO_DEFAULT;
  } catch {
    return AMORA_DOCK_RATIO_DEFAULT;
  }
}

/** 너비는 이 브라우저에만 남긴다. 계정에 적을 만큼 중요한 값이 아니다. */
export function writeAmoraDockRatio(
  value: number,
  storage: RatioStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(AMORA_DOCK_RATIO_STORAGE_KEY, String(clampAmoraDockRatio(value)));
  } catch {
    // 저장에 실패해도 이번 화면에서는 고른 너비를 그대로 쓴다.
  }
}

/** 입력칸에 넣을 질문을 다듬는다. 비었으면 null. */
export function normalizeAmoraPrefill(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AMORA_PREFILL_MAX_LENGTH);
}
