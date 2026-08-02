function isExactTrue(value: string | undefined): boolean {
  return value === "true";
}

export function isAmoraTodayOneEnabled(): boolean {
  return isExactTrue(process.env.AMORA_TODAY_ONE_ENABLED);
}

export function isAmoraProactiveChatEnabled(): boolean {
  return isExactTrue(process.env.AMORA_PROACTIVE_CHAT_ENABLED)
    && !isAmoraTodayOneEnabled();
}
