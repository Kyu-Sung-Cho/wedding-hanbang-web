#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATHS = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, "apps", "web", ".env.local"),
];

const IMAGE_BUCKET = "community-images";
const VIDEO_BUCKET = "community-videos";
const PUBLIC_OBJECT_PREFIX = "/storage/v1/object/public/";
const PAGE_SIZE = 500;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

for (const envPath of ENV_PATHS) loadEnvFile(envPath);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Put them in apps/web/.env.local."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function expectedBucket(kind) {
  return kind === "video" ? VIDEO_BUCKET : IMAGE_BUCKET;
}

function validateMediaUrl(rawUrl, { kind, ownerId }) {
  if (typeof rawUrl !== "string") return { ok: false, reason: "not_string" };
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) return { ok: false, reason: "empty" };

  let parsedUrl;
  let parsedSupabaseUrl;
  try {
    parsedUrl = new URL(trimmedUrl);
    parsedSupabaseUrl = new URL(supabaseUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (parsedUrl.origin !== parsedSupabaseUrl.origin) {
    return { ok: false, reason: "wrong_origin" };
  }
  if (parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
    return { ok: false, reason: "unsafe_url" };
  }
  if (!parsedUrl.pathname.startsWith(PUBLIC_OBJECT_PREFIX)) {
    return { ok: false, reason: "wrong_storage_path" };
  }

  let segments;
  try {
    segments = parsedUrl.pathname
      .slice(PUBLIC_OBJECT_PREFIX.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  const [bucket, folderOwnerId, ...pathParts] = segments;
  if (bucket !== expectedBucket(kind)) return { ok: false, reason: "wrong_bucket" };
  if (folderOwnerId !== ownerId) return { ok: false, reason: "wrong_owner" };
  if (
    pathParts.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment)
    )
  ) {
    return { ok: false, reason: "unsafe_path" };
  }

  return { ok: true };
}

function validateAttachmentUrl(rawUrl, { ownerId }) {
  const imageResult = validateMediaUrl(rawUrl, { kind: "image", ownerId });
  if (imageResult.ok) return imageResult;

  const videoResult = validateMediaUrl(rawUrl, { kind: "video", ownerId });
  if (videoResult.ok) return videoResult;

  return imageResult.reason === "wrong_bucket" ? videoResult : imageResult;
}

function extractHtmlImageSources(html) {
  if (typeof html !== "string" || !html.includes("<img")) return [];
  const sources = [];
  const imgSrcRe = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  let match;
  while ((match = imgSrcRe.exec(html))) {
    sources.push(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return sources;
}

async function fetchAll(table, select, filterBuilder) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (filterBuilder) query = filterBuilder(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function addIssue(issues, issue) {
  issues.push({
    ...issue,
    title: typeof issue.title === "string" ? issue.title.slice(0, 80) : null,
    url: typeof issue.url === "string" ? issue.url.slice(0, 240) : null,
  });
}

function auditPostMedia(posts) {
  const issues = [];
  let checked = 0;

  for (const post of posts) {
    for (const [index, url] of (Array.isArray(post.images) ? post.images : []).entries()) {
      checked += 1;
      const result = validateAttachmentUrl(url, { ownerId: post.author_id });
      if (!result.ok) {
        addIssue(issues, {
          source: "community_posts.images",
          post_id: post.id,
          title: post.title,
          index,
          reason: result.reason,
          url,
        });
      }
    }

    for (const [index, src] of extractHtmlImageSources(post.content).entries()) {
      checked += 1;
      const result = validateMediaUrl(src, { kind: "image", ownerId: post.author_id });
      if (!result.ok) {
        addIssue(issues, {
          source: "community_posts.content.img",
          post_id: post.id,
          title: post.title,
          index,
          reason: result.reason,
          url: src,
        });
      }
    }

    const slides = Array.isArray(post.slides) ? post.slides : [];
    for (const [index, slide] of slides.entries()) {
      if (!slide || typeof slide !== "object") {
        addIssue(issues, {
          source: "community_posts.slides",
          post_id: post.id,
          title: post.title,
          index,
          reason: "invalid_slide",
          url: null,
        });
        continue;
      }

      checked += 1;
      const kind = slide.type === "video" ? "video" : "image";
      const result = validateMediaUrl(slide.url, { kind, ownerId: post.author_id });
      if (!result.ok) {
        addIssue(issues, {
          source: "community_posts.slides.url",
          post_id: post.id,
          title: post.title,
          index,
          reason: result.reason,
          url: slide.url,
        });
      }

      if (typeof slide.thumbnail_url === "string" && slide.thumbnail_url.trim()) {
        checked += 1;
        const thumbResult = validateMediaUrl(slide.thumbnail_url, {
          kind: "image",
          ownerId: post.author_id,
        });
        if (!thumbResult.ok) {
          addIssue(issues, {
            source: "community_posts.slides.thumbnail_url",
            post_id: post.id,
            title: post.title,
            index,
            reason: thumbResult.reason,
            url: slide.thumbnail_url,
          });
        }
      }
    }
  }

  return { checked, issues };
}

function summarizeIssues(issues) {
  const summary = {};
  for (const issue of issues) {
    const key = `${issue.source}:${issue.reason}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return summary;
}

const posts = await fetchAll(
  "community_posts",
  "id, author_id, title, content, images, slides"
);
const postAudit = auditPostMedia(posts);

const polls = await fetchAll("community_polls", "id, post_id");
const pollToPostId = new Map(polls.map((poll) => [poll.id, poll.post_id]));
const postById = new Map(posts.map((post) => [post.id, post]));
const pollOptions = await fetchAll(
  "community_poll_options",
  "id, poll_id, position, image_url",
  (query) => query.not("image_url", "is", null)
);

const pollIssues = [];
let pollChecked = 0;
for (const option of pollOptions) {
  const post = postById.get(pollToPostId.get(option.poll_id));
  if (!post) {
    addIssue(pollIssues, {
      source: "community_poll_options.image_url",
      post_id: null,
      title: null,
      index: option.position,
      reason: "missing_parent_post",
      url: option.image_url,
    });
    continue;
  }

  pollChecked += 1;
  const result = validateMediaUrl(option.image_url, {
    kind: "image",
    ownerId: post.author_id,
  });
  if (!result.ok) {
    addIssue(pollIssues, {
      source: "community_poll_options.image_url",
      post_id: post.id,
      title: post.title,
      index: option.position,
      reason: result.reason,
      url: option.image_url,
    });
  }
}

const issues = [...postAudit.issues, ...pollIssues];
const report = {
  checked_at: new Date().toISOString(),
  posts: posts.length,
  media_fields_checked: postAudit.checked + pollChecked,
  issues_found: issues.length,
  summary: summarizeIssues(issues),
  issues,
};

console.log(JSON.stringify(report, null, 2));

if (issues.length > 0) {
  process.exitCode = 2;
}
