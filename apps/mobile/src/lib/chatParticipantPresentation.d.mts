export type ConfirmedWeddingRole = "bride" | "groom";
export type ChatBubbleTone = "amora" | "sky" | "rose" | "neutral";

export interface ChatParticipantPresentation {
  readonly selfId: string | null;
  readonly partnerId: string | null;
  readonly selfConfirmedRole: ConfirmedWeddingRole | null;
  readonly partnerConfirmedRole: ConfirmedWeddingRole | null;
  readonly selfAvatarUrl: string | null;
  readonly partnerAvatarUrl: string | null;
}

export declare const EMPTY_CHAT_PARTICIPANT_PRESENTATION: ChatParticipantPresentation;

export declare function confirmedRoleBubbleTone(confirmedRole: unknown): "sky" | "rose" | "neutral";

export declare function readChatParticipantPresentation(
  payload: unknown,
  expected: { selfId: string; partnerId: string | null; coupleId: string | null },
): ChatParticipantPresentation;

export declare function resolveChatSenderPresentation(input: {
  isAi: boolean;
  senderId: string | null | undefined;
  presentation: ChatParticipantPresentation | null | undefined;
}): { tone: ChatBubbleTone; avatarUrl: string | null; avatarOwnerId: string | null };

export declare function chatSenderAvatarName(input: {
  senderId: string | null | undefined;
  selfId: string | null | undefined;
  selfName: string | null | undefined;
  partnerId: string | null | undefined;
  partnerName: string | null | undefined;
}): string | null;
