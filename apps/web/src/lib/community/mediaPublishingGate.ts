/**
 * Controlled beta default: community media cannot be uploaded or newly
 * published. Enabling it is an explicit release decision, never a truthy-env
 * accident such as `1`, `TRUE`, or an unknown value.
 */
export function isCommunityMediaPublishingEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.COMMUNITY_MEDIA_PUBLISHING_ENABLED === "true";
}

export const COMMUNITY_MEDIA_DISABLED_CODE =
  "COMMUNITY_MEDIA_PUBLISHING_DISABLED";

type CommunityMediaVisibility = "draft" | "members" | "public";

type CommunityMediaPatch = {
  content?: unknown;
  images?: unknown;
  slides?: unknown;
  visibility?: unknown;
};

type ExistingCommunityMedia = {
  content: unknown;
  images: unknown;
  slides: unknown;
  visibility: unknown;
};

type NormalizedSlide = {
  type: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  thumbnail_url?: string;
};

const VISIBILITY_EXPOSURE: Record<CommunityMediaVisibility, number> = {
  draft: 0,
  members: 1,
  public: 2,
};

function isVisibility(value: unknown): value is CommunityMediaVisibility {
  return value === "draft" || value === "members" || value === "public";
}

function extractHtmlImageSources(value: unknown): string[] | null {
  if (typeof value !== "string") return null;

  const sources: string[] = [];
  const imageSourcePattern =
    /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
  let match: RegExpExecArray | null;
  while ((match = imageSourcePattern.exec(value))) {
    const source = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!source) return null;
    sources.push(source);
  }
  return sources;
}

function normalizeImages(value: unknown, allowNull: boolean): string[] | null {
  if (value === null && allowNull) return [];
  if (!Array.isArray(value)) return null;

  const images: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) return null;
    images.push(entry.trim());
  }
  return images;
}

function normalizeSlides(value: unknown): NormalizedSlide[] | null {
  if (value === null) return [];
  if (!Array.isArray(value)) return null;

  const slides: NormalizedSlide[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const slide = entry as Record<string, unknown>;
    if (slide.type !== "image" && slide.type !== "video") return null;
    if (typeof slide.url !== "string" || slide.url.trim().length === 0) return null;

    const normalized: NormalizedSlide = {
      type: slide.type,
      url: slide.url.trim(),
    };
    if (slide.width !== undefined && slide.width !== null) {
      if (typeof slide.width !== "number" || !Number.isFinite(slide.width)) return null;
      normalized.width = slide.width;
    }
    if (slide.height !== undefined && slide.height !== null) {
      if (typeof slide.height !== "number" || !Number.isFinite(slide.height)) return null;
      normalized.height = slide.height;
    }
    if (slide.thumbnail_url !== undefined && slide.thumbnail_url !== null) {
      if (typeof slide.thumbnail_url !== "string") return null;
      if (slide.thumbnail_url.trim().length > 0) {
        normalized.thumbnail_url = slide.thumbnail_url.trim();
      }
    }
    slides.push(normalized);
  }
  return slides;
}

function isOrderedSubset<T>(
  requested: readonly T[],
  existing: readonly T[],
  same: (left: T, right: T) => boolean,
): boolean {
  let existingIndex = 0;
  for (const requestedEntry of requested) {
    let found = false;
    while (existingIndex < existing.length) {
      if (same(requestedEntry, existing[existingIndex])) {
        found = true;
        existingIndex += 1;
        break;
      }
      existingIndex += 1;
    }
    if (!found) return false;
  }
  return true;
}

function sameSlide(left: NormalizedSlide, right: NormalizedSlide): boolean {
  return (
    left.type === right.type
    && left.url === right.url
    && left.width === right.width
    && left.height === right.height
    && left.thumbnail_url === right.thumbnail_url
  );
}

/**
 * While controlled-beta media is disabled, an existing post remains editable
 * without turning PATCH into a publishing bypass. The caller may retain media
 * exactly as stored or remove an ordered subset. New URLs, replacements,
 * duplication, reordering, malformed media shapes, and an audience expansion
 * that would newly publish retained media all fail closed.
 */
export function isCommunityMediaPatchAllowedWhileDisabled(
  patch: CommunityMediaPatch,
  existing: ExistingCommunityMedia,
): boolean {
  if (!isVisibility(existing.visibility)) return false;
  const requestedVisibility = patch.visibility === undefined
    ? existing.visibility
    : patch.visibility;
  if (!isVisibility(requestedVisibility)) return false;

  const existingContentImages = extractHtmlImageSources(existing.content);
  const requestedContentImages = patch.content === undefined
    ? existingContentImages
    : extractHtmlImageSources(patch.content);
  const existingImages = normalizeImages(existing.images ?? [], true);
  const requestedImages = patch.images === undefined
    ? existingImages
    : normalizeImages(patch.images, false);
  const existingSlides = normalizeSlides(existing.slides ?? null);
  const requestedSlides = patch.slides === undefined
    ? existingSlides
    : normalizeSlides(patch.slides);

  if (
    !existingContentImages
    || !requestedContentImages
    || !existingImages
    || !requestedImages
    || !existingSlides
    || !requestedSlides
  ) {
    return false;
  }

  const retainsOnlyExistingContentImages = isOrderedSubset(
    requestedContentImages,
    existingContentImages,
    (left, right) => left === right,
  );
  const retainsOnlyExistingImages = isOrderedSubset(
    requestedImages,
    existingImages,
    (left, right) => left === right,
  );
  const retainsOnlyExistingSlides = isOrderedSubset(
    requestedSlides,
    existingSlides,
    sameSlide,
  );
  if (
    !retainsOnlyExistingContentImages
    || !retainsOnlyExistingImages
    || !retainsOnlyExistingSlides
  ) {
    return false;
  }

  const expandsAudience =
    VISIBILITY_EXPOSURE[requestedVisibility]
    > VISIBILITY_EXPOSURE[existing.visibility];
  const retainsMedia =
    requestedContentImages.length > 0
    || requestedImages.length > 0
    || requestedSlides.length > 0;

  return !expandsAudience || !retainsMedia;
}
