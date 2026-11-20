"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  LETTER_STATE_COPY,
  type InquiryApproverMode,
  type InquiryApproverPut,
  type InquiryApproverRespondPost,
  type InquiryApproverResponse,
  type LetterApproveResult,
  type LetterModel,
  type LetterNotQueuedReason,
  type LetterSavePut,
  type LetterShare,
  type LetterState,
} from "@hanbang/shared/invitation";

import { invitationRequest, type InvitationApiFailure } from "./invitationApi";
import {
  isApproverResponse,
  isLetterApproveResponse,
  isLetterResponse,
  isLetterSaveResponse,
} from "./invitationGuards";
import { approverFailedMessage, letterFailedMessage } from "./liveStateCopy";
import { useMountedRef, type LiveIdentity } from "./useLiveIdentity";
import { useInvitationQuery } from "./useInvitationQuery";

type ShareKey = LetterShare["key"];

/** 이 판에서 사람이 바꾼 것. 판이 바뀌면(저장·다시 읽기) 버린다. */
type LetterEdits = {
  key: string;
  shares: Partial<Record<ShareKey, boolean>>;
  body: string | null;
  editing: boolean;
  /** 저장된 번호가 없을 때 새로 적은 휴대폰 번호. */
  phone: string;
};

export type LetterNotice = { tone: "status" | "error"; text: string };

export type InvitationLetterState = {
  loading: boolean;
  /** 편지를 읽지 못했다(승인 방식만 못 읽었으면 편지는 그대로 보이고 고르는 칸만 빠진다). */
  failed: boolean;
  failure: InvitationApiFailure | null;
  reload: () => void;
  /** 담은 홀이 없어 편지가 없다. */
  needShortlist: boolean;
  model: LetterModel | null;
  state: LetterState | null;
  approver: InquiryApproverResponse | null;
  editing: boolean;
  body: string;
  phone: string;
  /** 휴대폰 번호를 알려주기로 했는데 저장된 번호가 없어 새로 적어야 한다. */
  needsPhone: boolean;
  dirty: boolean;
  busy: boolean;
  notice: LetterNotice | null;
  /** 보내기 단추를 누를 수 있는가(이미 대기열에 넣었거나, 이 판을 이미 승인했고 고친 것이 없으면 못 누른다). */
  canSend: boolean;
  startEditing: () => void;
  setBody: (body: string) => void;
  setPhone: (phone: string) => void;
  toggleShare: (key: ShareKey) => void;
  send: () => Promise<void>;
  chooseApprover: (mode: Exclude<InquiryApproverMode, "unset">, designatedUserId?: string) => Promise<void>;
  /**
   * 상대가 낸 승인 방식 제안에 답한다(`true` 확인, `false` 거절). 제안한 사람이 아닌 다른 회원만 답할 수 있다.
   * 그 사이 제안이 바뀌었으면(409) 승인 방식을 다시 읽는다.
   */
  respondToProposal: (accept: boolean) => Promise<void>;
  /** 지금 승인 방식을 한 줄로(누가 승인하면 보낼 수 있는지). */
  approverLine: string | null;
  /** 확인을 기다리는 제안의 방식을 같은 꼴의 한 줄로. 제안이 없으면 null. */
  proposalLine: string | null;
  memberName: (id: string) => string | null;
};

/** 승인 방식 한 줄. 아직 고르지 않았으면 한 분이 승인하면 둘 다에게 알린다고 말한다. */
function modeLine(
  setting: { mode: InquiryApproverMode; designatedUserId: string | null },
  nameOf: (id: string) => string | null,
): string {
  if (setting.mode === "both") return LETTER_STATE_COPY.approverNeedsBoth;
  if (setting.mode === "designated") {
    const name = setting.designatedUserId ? nameOf(setting.designatedUserId) : null;
    return name ? LETTER_STATE_COPY.approverDesignated(name) : LETTER_STATE_COPY.approverUnset;
  }
  return LETTER_STATE_COPY.approverUnset;
}

function waitingLine(waitingFor: readonly string[], viewerId: string | null, nameOf: (id: string) => string | null): string | null {
  const ids = [...new Set(waitingFor)].filter((id) => id !== viewerId);
  const names = ids.map(nameOf).filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.map((name) => LETTER_STATE_COPY.waitingFor(name)).join(" ") : null;
}

/** 하루 상한(커플의 것이든 서비스 전체의 것이든)에 걸려 대기열에 넣지 못했다. 화면에는 같은 말이다. */
function hitDailyCap(reason: LetterNotQueuedReason | null): boolean {
  return reason === "daily_cap" || reason === "global_daily_cap";
}

/**
 * 아직 승인해야 하는 사람. 문의 보내기가 꺼진 동안 승인한 사람은 켜진 지금 다시 승인해야 하므로(`approvedWhilePaused`)
 * 보내기가 켜져 있으면 그 사람도 기다리는 사람으로 말한다. 칸이 없는 응답은 빈 목록으로 읽는다.
 */
function stillWaitingFor(state: LetterState): readonly string[] {
  const paused = state.sendingEnabled ? state.approvedWhilePaused ?? [] : [];
  return [...state.waitingFor, ...paused];
}

/** 불러온 편지의 상태를 사실대로 한 줄로. 보내기가 꺼져 있으면 승인만 저장됐다고 말한다. */
function stateLine(state: LetterState, viewerId: string | null, nameOf: (id: string) => string | null): string | null {
  if (state.status === "queued") return LETTER_STATE_COPY.alreadySent;
  if (state.status === "approved_not_queued") {
    if (state.notQueuedReason === "sending_disabled") return LETTER_STATE_COPY.approvedNotSent;
    if (hitDailyCap(state.notQueuedReason)) return LETTER_STATE_COPY.dailyCap;
    return null;
  }
  if (state.status === "awaiting_approval") return waitingLine(stillWaitingFor(state), viewerId, nameOf);
  return null;
}

/** 승인 결과를 한 줄로. 대기열에 넣었는지, 왜 넣지 않았는지, 누구를 기다리는지. */
function resultLine(result: LetterApproveResult, viewerId: string | null, nameOf: (id: string) => string | null): string | null {
  if (result.status === "queued") {
    return result.queuedCount > 0 ? LETTER_STATE_COPY.queued(result.queuedCount) : LETTER_STATE_COPY.alreadySent;
  }
  if (result.status === "approved_not_queued") {
    if (result.notQueuedReason === "sending_disabled") return LETTER_STATE_COPY.approvedNotSent;
    if (hitDailyCap(result.notQueuedReason)) return LETTER_STATE_COPY.dailyCap;
    return null;
  }
  return waitingLine(result.waitingFor, viewerId, nameOf);
}

/**
 * 편지 시트(`/halls/letter`)의 읽기와 쓰기.
 *
 *   - GET `/letter`·`/approver` 를 함께 읽는다.
 *   - 알려줄 정보·글을 바꾸면 보내기 전에 PUT `/letter` 로 새 판을 저장한다(판이 바뀌면 앞 승인은 이어지지 않는다).
 *   - 보내기는 POST `/letter/approve` 에 화면이 본 판 ID 와 지문을 그대로 보낸다. 그 사이 판이 바뀌었으면 409 라
 *     바뀐 편지를 다시 읽고 다시 확인하게 한다.
 *   - 문의 보내기 스위치가 꺼져 있으면 승인만 저장되고 업체로 가지 않았다고 사실대로 말한다.
 */
export function useInvitationLetter(identity: LiveIdentity): InvitationLetterState {
  const options = { owner: identity.owner, enabled: !identity.isDemo, refreshKey: identity.refreshKey };
  const letterQuery = useInvitationQuery("/letter", { ...options, accept: isLetterResponse });
  const approverQuery = useInvitationQuery("/approver", { ...options, accept: isApproverResponse });
  const [edits, setEdits] = useState<LetterEdits | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<LetterNotice | null>(null);
  const mounted = useMountedRef();
  // 같은 그림에서 두 번 누르면 두 번 다 `busy` 가 거짓으로 보인다. 쓰기 하나가 끝날 때까지 다음 쓰기를 막는 표시.
  const writingRef = useRef(false);

  const letterData = letterQuery.data;
  const approver = approverQuery.data;
  const state = letterData?.state ?? null;
  const letter = letterData?.letter ?? null;
  const viewerId = approver?.members.find((member) => member.isViewer)?.id ?? null;
  const editKey = state ? `${state.letterId ?? "new"}:${state.versionId ?? "draft"}` : "none";
  const ownEdits = edits && edits.key === editKey ? edits : null;

  const memberName = useCallback(
    (id: string) => approver?.members.find((member) => member.id === id)?.name ?? null,
    [approver],
  );

  const storedPhone = letter?.shares.find((share) => share.key === "phone")?.value ?? "";
  const model = useMemo<LetterModel | null>(() => {
    if (!letter) return null;
    return {
      ...letter,
      body: ownEdits?.body ?? letter.body,
      shares: letter.shares.map((share) => {
        const on = ownEdits?.shares[share.key] ?? share.on;
        const typedPhone = share.key === "phone" && on && !share.value ? ownEdits?.phone.trim() ?? "" : "";
        return { ...share, on, value: typedPhone || share.value };
      }),
    };
  }, [letter, ownEdits]);

  const dirty = Boolean(
    letter
      && ownEdits
      && (letter.shares.some((share) => (ownEdits.shares[share.key] ?? share.on) !== share.on)
        || (ownEdits.body !== null && ownEdits.body !== letter.body)
        || ownEdits.phone.trim() !== ""),
  );
  const phoneOn = model?.shares.find((share) => share.key === "phone")?.on ?? false;
  const needsPhone = phoneOn && !storedPhone;

  const editWith = useCallback(
    (change: (current: LetterEdits) => LetterEdits) => {
      setNotice(null);
      setEdits((previous) => {
        const base: LetterEdits = previous && previous.key === editKey
          ? previous
          : { key: editKey, shares: {}, body: null, editing: false, phone: "" };
        return change(base);
      });
    },
    [editKey],
  );

  const toggleShare = useCallback(
    (key: ShareKey) => {
      const current = model?.shares.find((share) => share.key === key)?.on ?? false;
      editWith((base) => ({ ...base, shares: { ...base.shares, [key]: !current } }));
    },
    [editWith, model],
  );
  const startEditing = useCallback(() => editWith((base) => ({ ...base, editing: true })), [editWith]);
  const setBody = useCallback((body: string) => editWith((base) => ({ ...base, body })), [editWith]);
  const setPhone = useCallback((phone: string) => editWith((base) => ({ ...base, phone })), [editWith]);

  const { reload: reloadLetter, replace: replaceLetter } = letterQuery;
  const { reload: reloadApprover, replace: replaceApprover } = approverQuery;

  /**
   * 쓰기 하나를 돌린다. 이미 하나가 돌고 있으면(같은 그림에서 두 번 누른 것 포함) 아무것도 하지 않는다 —
   * `busy` 는 다음 그림에서야 참이 되므로 그것만으로는 같은 그림의 두 번째 누름을 막지 못한다.
   */
  const writeOnce = useCallback(
    async (write: () => Promise<void>) => {
      if (writingRef.current) return;
      writingRef.current = true;
      setBusy(true);
      setNotice(null);
      try {
        await write();
      } finally {
        writingRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [mounted],
  );

  const send = useCallback(async () => {
    if (!letter || !state || !model || busy) return;
    await writeOnce(async () => {
      let versionId = state.versionId;
      let fingerprint = state.fingerprint;

      if (dirty || !versionId || !fingerprint) {
        const shareOn = (key: ShareKey) => model.shares.find((share) => share.key === key)?.on ?? false;
        const nameValue = model.shares.find((share) => share.key === "name")?.value ?? "";
        const body: LetterSavePut = {
          letterId: state.letterId,
          recipientHallIds: state.recipients.map((recipient) => recipient.hallId),
          body: model.body,
          shares: {
            name: { on: shareOn("name"), value: shareOn("name") ? nameValue || null : null },
            // 화면은 가린 번호만 받는다. 새로 적은 번호가 없으면 비워 보내 앞 판의 번호를 그대로 쓴다.
            phone: { on: shareOn("phone"), value: shareOn("phone") ? ownEdits?.phone.trim() || null : null },
            budget: { on: shareOn("budget") },
          },
        };
        const saved = await invitationRequest("/letter", { method: "PUT", body, accept: isLetterSaveResponse });
        if (!mounted.current) return;
        if (!saved.ok) {
          setNotice({ tone: "error", text: letterFailedMessage(saved) });
          if (saved.code === "LETTER_LOCKED") reloadLetter();
          return;
        }
        const { saved: version, ...response } = saved.data;
        replaceLetter(response);
        setEdits(null);
        versionId = version.versionId;
        fingerprint = version.fingerprint;
      }

      const approved = await invitationRequest("/letter/approve", {
        method: "POST",
        body: { versionId, fingerprint },
        accept: isLetterApproveResponse,
      });
      if (!mounted.current) return;
      if (!approved.ok) {
        setNotice({ tone: "error", text: letterFailedMessage(approved) });
        // 판이 바뀌었으면 바뀐 편지를 다시 읽는다. 사람이 다시 읽고 다시 눌러야 한다.
        if (approved.code === "LETTER_VERSION_CHANGED" || approved.code === "LETTER_LOCKED") reloadLetter();
        return;
      }
      if (approved.data.letter) replaceLetter(approved.data.letter);
      else reloadLetter();
      const line = resultLine(approved.data.result, viewerId, memberName);
      setNotice(line ? { tone: "status", text: line } : null);
    });
  }, [busy, dirty, letter, memberName, model, mounted, ownEdits, reloadLetter, replaceLetter, state, viewerId, writeOnce]);

  const chooseApprover = useCallback(
    async (mode: Exclude<InquiryApproverMode, "unset">, designatedUserId?: string) => {
      if (busy) return;
      await writeOnce(async () => {
        const body: InquiryApproverPut = mode === "designated" ? { mode, designatedUserId: designatedUserId ?? null } : { mode };
        const result = await invitationRequest("/approver", { method: "PUT", body, accept: isApproverResponse });
        if (!mounted.current) return;
        if (!result.ok) {
          setNotice({ tone: "error", text: approverFailedMessage(result) });
          return;
        }
        replaceApprover(result.data);
        // 바로 바뀌었을 때만(applied, 칸이 없던 서버 포함) 판 번호가 올라 앞 승인은 세지 않으니 편지를 다시 읽는다.
        // 상대의 승인 권한을 줄이는 변경은 제안으로만 남고(proposed), 지금 방식을 다시 고르면 제안을 거둔다
        // (withdrawn). 둘 다 지금 방식이 그대로라 편지를 다시 읽지 않는다.
        if (!result.data.outcome || result.data.outcome === "applied") reloadLetter();
      });
    },
    [busy, mounted, reloadLetter, replaceApprover, writeOnce],
  );

  const pending = approver?.pending ?? null;
  const respondToProposal = useCallback(
    async (accept: boolean) => {
      if (busy || !pending || !pending.viewerCanRespond) return;
      await writeOnce(async () => {
        const body: InquiryApproverRespondPost = { proposalId: pending.proposalId };
        const result = await invitationRequest(accept ? "/approver/confirm" : "/approver/decline", {
          method: "POST",
          body,
          accept: isApproverResponse,
        });
        if (!mounted.current) return;
        if (!result.ok) {
          setNotice({ tone: "error", text: approverFailedMessage(result) });
          // 그 사이 제안이 바뀌었거나 거둬졌다. 지금 방식을 다시 읽어 다시 보게 한다.
          if (result.code === "APPROVER_PROPOSAL_CHANGED") reloadApprover();
          return;
        }
        replaceApprover(result.data);
        // 확인하면 방식이 바뀌어 판 번호가 오른다. 편지 상태를 다시 읽는다.
        if (accept) reloadLetter();
      });
    },
    [busy, mounted, pending, reloadApprover, reloadLetter, replaceApprover, writeOnce],
  );

  const failure = letterQuery.failure ?? approverQuery.failure;
  const loading = (letterQuery.loading && !letterData) || (approverQuery.loading && !approver);
  const loadedLine = state ? stateLine(state, viewerId, memberName) : null;
  const shownNotice = notice ?? (loadedLine && !dirty ? { tone: "status" as const, text: loadedLine } : null);
  const canSend = Boolean(
    state && !busy && state.status !== "queued" && (state.viewerCanApprove || dirty),
  );

  return {
    loading,
    failed: Boolean(failure) && !letterData,
    failure,
    reload: () => {
      letterQuery.reload();
      approverQuery.reload();
    },
    needShortlist: Boolean(letterData && !letterData.letter),
    model,
    state,
    approver,
    editing: ownEdits?.editing ?? false,
    body: model?.body ?? "",
    phone: ownEdits?.phone ?? "",
    needsPhone,
    dirty,
    busy,
    notice: shownNotice,
    canSend,
    startEditing,
    setBody,
    setPhone,
    toggleShare,
    send,
    chooseApprover,
    respondToProposal,
    approverLine: approver ? modeLine(approver.setting, memberName) : null,
    proposalLine: pending ? modeLine(pending, memberName) : null,
    memberName,
  };
}
