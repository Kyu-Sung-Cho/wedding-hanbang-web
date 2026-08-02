const IMAGE_BUCKET = "community-images";
const VIDEO_BUCKET = "community-videos";
const PUBLIC_OBJECT_PREFIX = "/storage/v1/object/public/";
const MAX_MEDIA_URL_LENGTH = 4096;

const V2_IMAGE_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/;

const CLASSIFICATIONS = Object.freeze([
  "managed_v2",
  "legacy_owner_linked",
  "invalid",
]);

const SOURCES = Object.freeze([
  "community_posts.images",
  "community_posts.content.img",
  "community_posts.slides",
  "community_posts.slides.url",
  "community_posts.slides.thumbnail_url",
  "community_poll_options.image_url",
]);

const INVALID_REASONS = Object.freeze([
  "not_string",
  "empty",
  "too_long",
  "invalid_owner_context",
  "invalid_url",
  "wrong_origin",
  "unsafe_url",
  "wrong_storage_path",
  "unsafe_path",
  "wrong_bucket",
  "unsafe_v2_path",
  "wrong_owner",
  "invalid_slide",
  "missing_parent_post",
  "unknown",
]);

function expectedBucket(kind) {
  return kind === "video" ? VIDEO_BUCKET : IMAGE_BUCKET;
}

function invalid(reason) {
  return { classification: "invalid", reason };
}

function isUnsafeSegment(segment) {
  return !segment
    || segment === "."
    || segment === ".."
    || segment.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(segment);
}

/**
 * Classifies a media reference without returning any part of the input. This is
 * an intentional privacy boundary: callers may aggregate the result but cannot
 * accidentally serialize a URL, UUID, owner ID, or object path.
 */
export function classifyCommunityMediaUrl(rawUrl, { kind, ownerId, supabaseUrl }) {
  if (typeof rawUrl !== "string") return invalid("not_string");
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) return invalid("empty");
  if (trimmedUrl.length > MAX_MEDIA_URL_LENGTH) return invalid("too_long");
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    return invalid("invalid_owner_context");
  }

  let parsedUrl;
  let parsedSupabaseUrl;
  try {
    parsedUrl = new URL(trimmedUrl);
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    return invalid("invalid_url");
  }

  if (parsedUrl.origin !== parsedSupabaseUrl.origin) return invalid("wrong_origin");
  if (parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
    return invalid("unsafe_url");
  }
  if (!parsedUrl.pathname.startsWith(PUBLIC_OBJECT_PREFIX)) {
    return invalid("wrong_storage_path");
  }

  const suffix = parsedUrl.pathname.slice(PUBLIC_OBJECT_PREFIX.length);
  const rawSegments = suffix.split("/");
  let segments;
  try {
    segments = rawSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    return invalid("invalid_url");
  }

  if (segments.length < 3 || segments.some(isUnsafeSegment)) {
    return invalid("unsafe_path");
  }

  const [bucket, ownerOrVersion, ...pathParts] = segments;
  if (bucket !== expectedBucket(kind)) return invalid("wrong_bucket");

  if (ownerOrVersion === "v2") {
    if (
      kind !== "image"
      || rawSegments.length !== segments.length
      || rawSegments.some((segment, index) => segment !== segments[index])
      || pathParts.length !== 1
      || !V2_IMAGE_FILE_RE.test(pathParts[0])
    ) {
      return invalid("unsafe_v2_path");
    }
    return { classification: "managed_v2" };
  }

  if (ownerOrVersion !== ownerId) return invalid("wrong_owner");
  return { classification: "legacy_owner_linked" };
}

export function classifyCommunityAttachmentUrl(rawUrl, options) {
  const imageResult = classifyCommunityMediaUrl(rawUrl, {
    ...options,
    kind: "image",
  });
  if (imageResult.classification !== "invalid") return imageResult;

  if (imageResult.reason !== "wrong_bucket") return imageResult;
  return classifyCommunityMediaUrl(rawUrl, {
    ...options,
    kind: "video",
  });
}

export function extractHtmlImageSources(html) {
  if (typeof html !== "string" || !html.includes("<img")) return [];
  const sources = [];
  const imgSrcRe = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  let match;
  while ((match = imgSrcRe.exec(html))) {
    sources.push(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return sources;
}

function emptyClassificationCounts() {
  return Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]));
}

function emptySourceCounts() {
  return Object.fromEntries(
    SOURCES.map((source) => [source, emptyClassificationCounts()]),
  );
}

function recordClassification(state, source, result) {
  const classification = CLASSIFICATIONS.includes(result.classification)
    ? result.classification
    : "invalid";
  state.mediaFieldsChecked += 1;
  state.classificationCounts[classification] += 1;
  state.sourceCounts[source][classification] += 1;

  if (classification === "invalid") {
    const reason = INVALID_REASONS.includes(result.reason) ? result.reason : "unknown";
    state.invalidReasonCounts[reason] = (state.invalidReasonCounts[reason] ?? 0) + 1;
  }
}

/**
 * Audits in-memory rows and returns counts only. Raw row values are deliberately
 * excluded from the return type so JSON serialization is safe for CI logs.
 */
export function auditCommunityMediaRows({
  posts,
  polls,
  pollOptions,
  supabaseUrl,
  checkedAt = new Date().toISOString(),
}) {
  const safePosts = Array.isArray(posts) ? posts : [];
  const safePolls = Array.isArray(polls) ? polls : [];
  const safePollOptions = Array.isArray(pollOptions) ? pollOptions : [];
  const state = {
    mediaFieldsChecked: 0,
    classificationCounts: emptyClassificationCounts(),
    sourceCounts: emptySourceCounts(),
    invalidReasonCounts: {},
  };

  for (const post of safePosts) {
    const ownerId = post?.author_id;
    for (const url of Array.isArray(post?.images) ? post.images : []) {
      recordClassification(
        state,
        "community_posts.images",
        classifyCommunityAttachmentUrl(url, { ownerId, supabaseUrl }),
      );
    }

    for (const src of extractHtmlImageSources(post?.content)) {
      recordClassification(
        state,
        "community_posts.content.img",
        classifyCommunityMediaUrl(src, { kind: "image", ownerId, supabaseUrl }),
      );
    }

    for (const slide of Array.isArray(post?.slides) ? post.slides : []) {
      if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
        recordClassification(
          state,
          "community_posts.slides",
          invalid("invalid_slide"),
        );
        continue;
      }

      const kind = slide.type === "video" ? "video" : "image";
      recordClassification(
        state,
        "community_posts.slides.url",
        classifyCommunityMediaUrl(slide.url, { kind, ownerId, supabaseUrl }),
      );

      if (typeof slide.thumbnail_url === "string" && slide.thumbnail_url.trim()) {
        recordClassification(
          state,
          "community_posts.slides.thumbnail_url",
          classifyCommunityMediaUrl(slide.thumbnail_url, {
            kind: "image",
            ownerId,
            supabaseUrl,
          }),
        );
      }
    }
  }

  const pollToPostId = new Map(safePolls.map((poll) => [poll?.id, poll?.post_id]));
  const postById = new Map(safePosts.map((post) => [post?.id, post]));
  for (const option of safePollOptions) {
    const post = postById.get(pollToPostId.get(option?.poll_id));
    if (!post) {
      recordClassification(
        state,
        "community_poll_options.image_url",
        invalid("missing_parent_post"),
      );
      continue;
    }

    recordClassification(
      state,
      "community_poll_options.image_url",
      classifyCommunityMediaUrl(option?.image_url, {
        kind: "image",
        ownerId: post.author_id,
        supabaseUrl,
      }),
    );
  }

  const findingsCount = state.classificationCounts.legacy_owner_linked
    + state.classificationCounts.invalid;
  const normalizedCheckedAt = typeof checkedAt === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(checkedAt)
      ? checkedAt
      : new Date().toISOString();
  return {
    schema_version: 2,
    checked_at: normalizedCheckedAt,
    status: findingsCount === 0 ? "clean" : "review_required",
    posts_scanned: safePosts.length,
    poll_options_scanned: safePollOptions.length,
    media_fields_checked: state.mediaFieldsChecked,
    findings_count: findingsCount,
    classification_counts: state.classificationCounts,
    source_counts: state.sourceCounts,
    invalid_reason_counts: state.invalidReasonCounts,
  };
}

export function auditExitCode(report) {
  return report?.status === "clean" ? 0 : 2;
}

export function safeAuditFailureReport(errorCode = "AUDIT_FAILED") {
  const allowedCodes = new Set([
    "CONFIGURATION_MISSING",
    "DESTINATION_VERIFICATION_FAILED",
    "DATABASE_QUERY_FAILED",
    "AUDIT_FAILED",
  ]);
  return {
    schema_version: 2,
    status: "error",
    error_code: allowedCodes.has(errorCode) ? errorCode : "AUDIT_FAILED",
  };
}
