// HTML 정화 (XSS 방지)
// isomorphic-dompurify가 Vercel에서 jsdom ESM 충돌 → 서버용 간단 정규식 사용

function stripDangerous(dirty: string): string {
  return dirty
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<input[\s\S]*?>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/on\w+\s*=\s*[^\s>]*/gi, "")
    .replace(/javascript\s*:/gi, "");
}

export function sanitizeHtml(dirty: string): string {
  return stripDangerous(dirty);
}

export function sanitizeText(dirty: string): string {
  return dirty.replace(/<[^>]*>/g, "").trim();
}

export function validateTextInput(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}
