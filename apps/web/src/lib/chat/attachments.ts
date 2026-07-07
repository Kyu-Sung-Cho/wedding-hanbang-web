export type ChatAttachmentDraft = {
  base64: string;
  mediaType: string;
  previewUrl?: string;
  fileName?: string;
};

export function chatAttachmentKey(attachment: Pick<ChatAttachmentDraft, "base64" | "mediaType">): string {
  return `${attachment.mediaType}:${attachment.base64}`;
}

export function dedupeChatAttachments<T extends Pick<ChatAttachmentDraft, "base64" | "mediaType">>(
  attachments: readonly T[] | null | undefined
): T[] {
  if (!attachments || attachments.length === 0) return [];

  const seen = new Set<string>();
  const unique: T[] = [];
  for (const attachment of attachments) {
    const key = chatAttachmentKey(attachment);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(attachment);
  }
  return unique;
}
