const PUBLIC_OBJECT_PREFIX = "/storage/v1/object/public/";
const MAX_MEDIA_URL_LENGTH = 2048;

export const COMMUNITY_IMAGE_BUCKET = "community-images";
export const COMMUNITY_VIDEO_BUCKET = "community-videos";

export type CommunityMediaKind = "image" | "video";
export type CommunityMediaBucket =
  | typeof COMMUNITY_IMAGE_BUCKET
  | typeof COMMUNITY_VIDEO_BUCKET;

type ValidationSuccess = {
  ok: true;
  url: string;
  bucket: CommunityMediaBucket;
  ownerId: string;
  objectPath: string;
};

type ValidationFailure = {
  ok: false;
  reason:
    | "not_string"
    | "too_long"
    | "missing_supabase_url"
    | "invalid_url"
    | "wrong_origin"
    | "unsafe_url"
    | "wrong_storage_path"
    | "wrong_bucket"
    | "unsafe_path"
    | "wrong_owner";
};

export type CommunityMediaValidationResult = ValidationSuccess | ValidationFailure;

export type CommunityAttachmentValidationResult =
  | (ValidationSuccess & { kind: CommunityMediaKind })
  | ValidationFailure;

export type CommunityHtmlImageValidationResult =
  | { ok: true }
  | { ok: false; src: string; reason: ValidationFailure["reason"] };

const BUCKET_BY_KIND: Record<CommunityMediaKind, CommunityMediaBucket> = {
  image: COMMUNITY_IMAGE_BUCKET,
  video: COMMUNITY_VIDEO_BUCKET,
};

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const UPLOAD_SESSION_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/i;

function fail(reason: ValidationFailure["reason"]): ValidationFailure {
  return { ok: false, reason };
}

function normalizeOwnerIds(ownerIds: string | string[]): Set<string> {
  const raw = Array.isArray(ownerIds) ? ownerIds : [ownerIds];
  return new Set(raw.map((id) => id.trim()).filter(Boolean));
}

function decodePathSegments(pathname: string): string[] | null {
  try {
    return pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function isUnsafeSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    CONTROL_CHAR_RE.test(segment)
  );
}

export function validateCommunityMediaUrl(
  rawUrl: unknown,
  options: {
    kind: CommunityMediaKind;
    ownerIds: string | string[];
    supabaseUrl?: string;
    requireUploadSessionPath?: boolean;
  }
): CommunityMediaValidationResult {
  if (typeof rawUrl !== "string") return fail("not_string");

  const trimmedUrl = rawUrl.trim();
  if (trimmedUrl.length === 0 || trimmedUrl.length > MAX_MEDIA_URL_LENGTH) {
    return fail("too_long");
  }

  const supabaseUrl = options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return fail("missing_supabase_url");

  let parsedUrl: URL;
  let parsedSupabaseUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    return fail("invalid_url");
  }

  if (parsedUrl.origin !== parsedSupabaseUrl.origin) return fail("wrong_origin");
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    return fail("unsafe_url");
  }
  if (!parsedUrl.pathname.startsWith(PUBLIC_OBJECT_PREFIX)) {
    return fail("wrong_storage_path");
  }

  const suffix = parsedUrl.pathname.slice(PUBLIC_OBJECT_PREFIX.length);
  const rawSegments = suffix.split("/");
  const segments = decodePathSegments(suffix);
  if (!segments || segments.length < 3) return fail("wrong_storage_path");
  if (segments.some(isUnsafeSegment)) return fail("unsafe_path");

  const [bucket, ownerId, ...pathParts] = segments;
  const expectedBucket = BUCKET_BY_KIND[options.kind];
  if (bucket !== expectedBucket) return fail("wrong_bucket");

  const allowedOwners = normalizeOwnerIds(options.ownerIds);
  if (!allowedOwners.has(ownerId)) return fail("wrong_owner");
  if (options.requireUploadSessionPath) {
    if (rawSegments.length !== segments.length
        || rawSegments.some((segment, index) => segment !== segments[index])
        || pathParts.length !== 1
        || !UPLOAD_SESSION_FILE_RE.test(pathParts[0])) {
      return fail("unsafe_path");
    }
  }

  const objectPath = [ownerId, ...pathParts].join("/");
  return {
    ok: true,
    url: trimmedUrl,
    bucket,
    ownerId,
    objectPath,
  };
}

export function validateCommunityAttachmentUrl(
  rawUrl: unknown,
  options: {
    ownerIds: string | string[];
    supabaseUrl?: string;
  }
): CommunityAttachmentValidationResult {
  const imageResult = validateCommunityMediaUrl(rawUrl, {
    kind: "image",
    ownerIds: options.ownerIds,
    supabaseUrl: options.supabaseUrl,
    requireUploadSessionPath: true,
  });
  if (imageResult.ok) return { ...imageResult, kind: "image" };
  return imageResult;
}

/**
 * New images must use the sanitized upload-session path. Updates may retain an
 * older image URL only when that exact URL was already stored on the same post.
 * Thumbnail URLs count as existing media because they share the same consumer
 * attachment and cannot expand access to another post or owner.
 */
export function validateRetainedCommunityImageUrl(
  rawUrl: unknown,
  existingMedia: unknown,
  options: {
    ownerIds: string | string[];
    supabaseUrl?: string;
  },
): CommunityMediaValidationResult {
  const result = validateCommunityMediaUrl(rawUrl, {
    kind: "image",
    ownerIds: options.ownerIds,
    supabaseUrl: options.supabaseUrl,
  });
  if (!result.ok) return result;

  const retainedUrls = new Set<string>();
  for (const entry of Array.isArray(existingMedia) ? existingMedia : []) {
    if (typeof entry === "string") {
      retainedUrls.add(entry.trim());
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const media = entry as Record<string, unknown>;
    if (media.type === "image" && typeof media.url === "string") {
      retainedUrls.add(media.url.trim());
    }
    if (typeof media.thumbnail_url === "string") {
      retainedUrls.add(media.thumbnail_url.trim());
    }
  }
  return retainedUrls.has(result.url) ? result : fail("unsafe_path");
}

/**
 * Video sanitation is not release-ready, so updates may only retain a URL that
 * was already stored on the same post. This keeps historical posts editable
 * without creating a back door for a new video URL.
 */
export function validateRetainedCommunityVideoUrl(
  rawUrl: unknown,
  existingSlides: unknown,
  options: {
    ownerIds: string | string[];
    supabaseUrl?: string;
  },
): CommunityMediaValidationResult {
  const result = validateCommunityMediaUrl(rawUrl, {
    kind: "video",
    ownerIds: options.ownerIds,
    supabaseUrl: options.supabaseUrl,
  });
  if (!result.ok) return result;

  const retainedUrls = new Set(
    (Array.isArray(existingSlides) ? existingSlides : [])
      .filter((slide): slide is Record<string, unknown> =>
        typeof slide === "object" && slide !== null && !Array.isArray(slide)
      )
      .filter((slide) => slide.type === "video" && typeof slide.url === "string")
      .map((slide) => (slide.url as string).trim()),
  );
  return retainedUrls.has(result.url) ? result : fail("unsafe_path");
}

export function validateCommunityHtmlImageSources(
  html: string,
  options: {
    ownerIds: string | string[];
    supabaseUrl?: string;
  }
): CommunityHtmlImageValidationResult {
  const imgSrcRe = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = imgSrcRe.exec(html))) {
    const src = match[2] ?? match[3] ?? match[4] ?? "";
    const result = validateCommunityMediaUrl(src, {
      kind: "image",
      ownerIds: options.ownerIds,
      supabaseUrl: options.supabaseUrl,
      requireUploadSessionPath: true,
    });
    if (!result.ok) return { ok: false, src, reason: result.reason };
  }

  return { ok: true };
}
