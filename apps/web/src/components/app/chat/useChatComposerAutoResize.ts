import { useLayoutEffect, type RefObject } from "react";

export const MAX_CHAT_COMPOSER_HEIGHT_PX = 160;

export function resizeChatComposerToContent(
  textarea: HTMLTextAreaElement,
  value: string,
): void {
  textarea.style.height = "auto";
  if (value.length === 0) return;

  textarea.style.height = `${Math.min(
    textarea.scrollHeight,
    MAX_CHAT_COMPOSER_HEIGHT_PX,
  )}px`;
}

export function useChatComposerAutoResize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    resizeChatComposerToContent(textarea, value);
  }, [textareaRef, value]);
}
