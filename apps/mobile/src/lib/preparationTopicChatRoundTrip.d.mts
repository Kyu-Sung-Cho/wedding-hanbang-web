import type { AmoraChatLane } from "@hanbang/shared/chat-lane";

export type PreparationTopicChatHandoffBinding = Readonly<{
  topicKey: string;
  topicLabel: string;
  journeyRevision: number;
  actionRef: Readonly<{
    id: string;
    revision: number | null;
  }> | null;
}>;

export type PreparationTopicChatComposerBinding = Readonly<{
  ownerUserId: string;
  coupleId: string;
  prompt: string;
  preparationTopic: PreparationTopicChatHandoffBinding;
}>;

export type PreparationTopicChatReturnReceipt = Readonly<{
  ownerUserId: string;
  coupleId: string;
  assistantMessageId: string;
  serverRequestKey: string;
  preparationTopic: PreparationTopicChatHandoffBinding;
}>;

export function parsePreparationTopicChatHandoffBinding(
  value: unknown,
): PreparationTopicChatHandoffBinding | null;

export function createPreparationTopicChatComposerBinding(input: Readonly<{
  preparationTopic: unknown;
  ownerUserId: string;
  coupleId: string;
  prompt: string;
}>): PreparationTopicChatComposerBinding | null;

export function reconcilePreparationTopicChatComposerBinding(
  binding: PreparationTopicChatComposerBinding | null,
  context: Readonly<{
    ownerUserId: string | null;
    coupleId: string | null;
    lane: AmoraChatLane | null;
    privateText: string;
  }>,
): PreparationTopicChatComposerBinding | null;

export function resolvePreparationTopicChatBindingForSend(
  binding: PreparationTopicChatComposerBinding | null,
  context: Readonly<{
    ownerUserId: string | null;
    coupleId: string | null;
    lane: AmoraChatLane | null;
    privateText: string;
  }>,
): PreparationTopicChatComposerBinding | null;

export function createPreparationTopicChatReturnReceipt(input: Readonly<{
  binding: PreparationTopicChatComposerBinding | null;
  ownerUserId: string;
  coupleId: string;
  lane: AmoraChatLane;
  visibility: string;
  requestText: string;
  responseText: string;
  serverMessageId: unknown;
  serverRequestKey: string;
}>): PreparationTopicChatReturnReceipt | null;

export function buildPreparationTopicChatReturnDestination(
  receipt: PreparationTopicChatReturnReceipt | null,
  identity: Readonly<{
    ownerUserId: string;
    coupleId: string;
  }>,
): Readonly<{
  pathname: "/checklist";
  params: Readonly<{
    category: string;
    action?: string;
    actionRevision?: string;
  }>;
}> | null;
