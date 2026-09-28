import type { z } from "zod";

export class ProviderRequestError extends Error {
  constructor(public readonly status: number) {
    super(providerErrorMessage(status));
  }
}

export function providerErrorMessage(status: number): string {
  if (status === 401) return "로그인이 만료되었어요. 다시 로그인한 뒤 이어가 주세요.";
  if (status === 403) return "계정 동의 또는 현재 관리 권한을 확인할 수 없어요. 다시 로그인하거나 처리 상태를 확인해 주세요.";
  if (status === 409) return "다른 변경이 먼저 반영되었어요. 최신 내용을 다시 불러온 뒤 확인해 주세요.";
  if (status === 413) return "파일이 너무 커요. 5MB 이하의 사진을 선택해 주세요.";
  if (status === 429) return "요청이 잠시 많아졌어요. 조금 뒤 다시 시도해 주세요.";
  if (status === 503) return "현재 이 기능을 이용하기 어려워요. 잠시 뒤 다시 시도해 주세요.";
  if (status === 400 || status === 415 || status === 422) return "입력 내용이나 파일 형식을 확인해 주세요. 필수 항목과 사진 조건을 다시 확인해 주세요.";
  return "요청 결과를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

export async function providerRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new ProviderRequestError(response.status);
  try { return await response.json(); } catch { throw new ProviderRequestError(502); }
}

export async function providerRead<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const result = schema.safeParse(await providerRequest(path, { signal }));
  if (!result.success) throw new ProviderRequestError(502);
  return result.data;
}

export function providerJson(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function providerFailure(error: unknown): string {
  return error instanceof ProviderRequestError ? error.message : "연결이 원활하지 않아요. 잠시 뒤 다시 시도해 주세요.";
}

export function safeProviderWebsite(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function providerDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "확인 필요" : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(date);
}
