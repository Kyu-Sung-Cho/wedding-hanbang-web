"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ACTIVITY_COPY,
  COMPARE_COPY,
  HOME_COPY,
  WEB_COPY,
  type ActivityItem,
  type AmoraOrbMoodName,
  type WebChatLine,
  type WebSpaceModel,
  type WebSpaceTabId,
} from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import InvitationCard from "./InvitationCard";
import { SendArrowIcon } from "./InvitationIcons";
import {
  DecisionRows,
  PersonChips,
  UpdateActionPill,
  withLeadDecision,
  type InvitationLeadDecision,
} from "./InvitationParts";
import {
  INVITATION_BACKDROP_SRC,
  INVITATION_BUTTON_TEXT,
  INVITATION_DESCENDANT_WRAP,
  cx,
  defaultInvitationPhotoSrc,
  type InvitationPhotoResolver,
  type InvitationRouteResolver,
} from "./invitationScreen";

type InvitationWebSpaceProps = {
  model: WebSpaceModel;
  resolveRoute: InvitationRouteResolver;
  photoSrc?: InvitationPhotoResolver;
  /** 큰 오브의 기분. 아티팩트 웹 화면은 답장이 온 뒤라 `happy` 다. */
  orbMood?: AmoraOrbMoodName;
  /**
   * 왼쪽 칸에 실제 아모라 대화를 넣는 자리. 넣으면 모델의 예시 줄·제안·입력칸 대신 이것을 그린다.
   * 머리(로고·두 사람)와 오브는 그대로 둔다.
   */
  children?: ReactNode;
  onChatAction?: (label: string) => void;
  onSuggestion?: (text: string) => void;
  /** 입력칸에서 보낸 글. 없으면 보내기는 아무 일도 하지 않는다(예시 화면). */
  onSend?: (text: string) => void;
  initialTab?: WebSpaceTabId;
  /**
   * 실제 커플 화면: 목록이 비었거나 읽지 못했을 때 그 칸에 대신 그릴 것(할 일·오늘 한 일·웨딩홀 후보·준비 순서).
   * 목록이 비어 있을 때만 그린다. 예시 커플은 넘기지 않는다.
   */
  emptyStates?: Partial<Record<"decisions" | "activity" | "halls" | "plan", ReactNode>>;
  /**
   * 실제 커플 화면의 알림 자리. 청첩장 사진 바로 아래, 탭 위에 온다(폰 홈의 알림 자리와 같은 순서).
   * 할 말이 없으면 알림이 아무것도 그리지 않는다. 예시 커플은 넘기지 않는다.
   */
  notices?: ReactNode;
  /** 실제 커플 화면: "두 분이 정할 것" 맨 앞에 더하는 한 줄(조건이 비어 있을 때 첫 대화를 다시 연다). */
  leadDecision?: InvitationLeadDecision;
  /** 실제 커플 화면: 준비 공간 맨 아래(다른 화면으로 가는 링크, AI 서비스 고지). */
  footer?: ReactNode;
  className?: string;
};

type ActivityActor = keyof typeof ACTIVITY_COPY.actorLabel;

/**
 * 활동의 주체(`actor`). 서버가 이 칸을 주면 운영 담당자가 한 일을 아모라가 한 것처럼 쓰지 않게 이름을 붙인다.
 * 서버가 아직 주지 않으면(예시 커플 포함) 아무것도 붙이지 않는다.
 */
function activityActor(item: ActivityItem): ActivityActor | null {
  if (!("actor" in item)) return null;
  const actor = (item as { actor?: unknown }).actor;
  return typeof actor === "string" && actor in ACTIVITY_COPY.actorLabel ? (actor as ActivityActor) : null;
}

const CARD = "rounded-[26px] bg-inv-white p-[22px] shadow-[0_0_0_1px_#EEEAE6]";

function ExampleChatLines({
  lines,
  onAction,
}: {
  lines: readonly WebChatLine[];
  onAction?: (label: string) => void;
}) {
  return (
    <div className={cx("mx-auto flex w-full max-w-[540px] flex-col gap-[18px]", INVITATION_DESCENDANT_WRAP)}>
      {lines.map((line, index) => {
        const key = `${line.kind}-${index}`;
        if (line.kind === "amora") {
          return (
            <p key={key} className="text-[17px] leading-[1.7]">
              {line.text}
            </p>
          );
        }
        if (line.kind === "person") {
          return (
            <div key={key} className="self-end rounded-[20px] bg-inv-stone px-4 py-2.5 text-[15px]">
              {line.text}
            </div>
          );
        }
        return (
          <div key={key} className="flex flex-wrap gap-2">
            {line.actions.map((action) => (
              <UpdateActionPill
                key={action.label}
                label={action.label}
                tone={action.tone}
                onClick={onAction ? () => onAction(action.label) : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ChatComposer({
  suggestions,
  onSuggestion,
  onSend,
}: {
  suggestions: readonly string[];
  onSuggestion?: (text: string) => void;
  onSend?: (text: string) => void;
}) {
  const inputId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSend) return;
    const input = event.currentTarget.elements.namedItem("message");
    if (!(input instanceof HTMLInputElement)) return;
    const text = input.value.trim();
    if (!text) return;
    onSend(text);
    input.value = "";
  }

  return (
    <div className={cx("mx-auto flex w-full max-w-[540px] flex-col gap-2.5", INVITATION_DESCENDANT_WRAP)}>
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              variant="outline"
              size="pill-38"
              // 제안 칩의 테두리는 칩 선이 아니라 카드 고리 색이다(`Web.dc`). 글자색은 아티팩트가 적지 않아 기본 단추색이다.
              className={cx("border-inv-ring! px-3.5", INVITATION_BUTTON_TEXT)}
              onClick={onSuggestion ? () => onSuggestion(suggestion) : undefined}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
      <form onSubmit={handleSubmit}>
        <label htmlFor={inputId} className="sr-only">
          {WEB_COPY.inputLabel}
        </label>
        <div className="flex items-center gap-2 rounded-[28px] bg-inv-paper-soft py-1.5 pr-1.5 pl-5 shadow-[inset_0_0_0_1px_#EEEAE6]">
          {/* 아티팩트 입력칸은 높이 44px 에 브라우저 기본 안쪽 여백(위아래 1, 좌우 2)이 더해져 46px 이다. */}
          <input
            id={inputId}
            name="message"
            type="text"
            autoComplete="off"
            placeholder={WEB_COPY.inputPlaceholder}
            className="h-[46px] flex-1 border-none bg-transparent px-0.5 py-px text-[15px]"
          />
          <Button type="submit" variant="ink" size="pill-44" className="w-11 p-0" aria-label={WEB_COPY.send}>
            <SendArrowIcon />
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * 웹 넓은 화면(`Web.dc`, 1440×1000). 왼쪽은 아모라와 대화, 오른쪽은 두 사람의 준비 공간이다.
 * 두 칸은 아티팩트처럼 줄바꿈 가능한 가로 배치다(왼쪽 420px 기준, 오른쪽 560px 기준).
 *
 * 아티팩트와 다른 점(이유):
 *   - 높이 1000px 대신 부모가 준 높이를 채우고, 내용이 더 길면 화면째 스크롤한다.
 *     아티팩트의 1000 은 미리보기 틀의 높이다.
 *   - 탭은 방향키·Home·End 로 옮겨 가고, 탭마다 패널을 이름으로 잇는다.
 */
export default function InvitationWebSpace({
  model,
  resolveRoute,
  photoSrc = defaultInvitationPhotoSrc,
  orbMood = "happy",
  children,
  onChatAction,
  onSuggestion,
  onSend,
  initialTab = "today",
  emptyStates,
  notices,
  leadDecision,
  footer,
  className,
}: InvitationWebSpaceProps) {
  const [tab, setTab] = useState<WebSpaceTabId>(initialTab);
  const decisions = withLeadDecision(model.decisions, leadDecision);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabId = (id: WebSpaceTabId) => `${baseId}-tab-${id}`;
  const panelId = (id: WebSpaceTabId) => `${baseId}-panel-${id}`;

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = WEB_COPY.tabs.length - 1;
    const nextIndex =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (nextIndex === null) return;
    event.preventDefault();
    setTab(WEB_COPY.tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  const panelProps = (id: WebSpaceTabId) => ({
    role: "tabpanel" as const,
    id: panelId(id),
    "aria-labelledby": tabId(id),
    hidden: tab !== id,
    tabIndex: 0,
    "data-panel": id,
  });

  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-wrap overflow-y-auto bg-inv-white font-inv-sans leading-[normal] text-inv-ink break-normal",
        className,
      )}
      data-invitation-screen="web"
    >
      <section
        aria-label={WEB_COPY.chatRegion}
        className={cx(
          "flex max-w-full flex-[1_1_420px] flex-col gap-[22px] border-r border-inv-divider px-[clamp(20px,3vw,44px)] py-7",
          // 실제 대화를 넣으면 대화 칸은 창 높이에 붙어 있고 그 안에서만 스크롤한다. 오른쪽 준비 공간이 길어도
          // 입력칸이 화면 밖으로 밀리지 않는다(아티팩트의 1000px 틀은 미리보기 높이라 이 경우가 없다).
          children ? "sticky top-0 h-full self-start" : null,
        )}
      >
        <div className={cx("flex items-center justify-between", INVITATION_DESCENDANT_WRAP)}>
          <span className="font-inv-numeral text-[28px] font-medium italic">{HOME_COPY.wordmark}</span>
          <PersonChips people={model.people} variant="web" />
        </div>
        <div className={cx("flex flex-col items-center gap-2 pt-5 pb-1", INVITATION_DESCENDANT_WRAP)}>
          <AmoraOrb size={110} mood={orbMood} />
          {model.orbCaption ? <span className="text-[13px] text-inv-muted">{model.orbCaption}</span> : null}
        </div>
        {children ? (
          // 끼운 실제 대화는 앱 기본 글 흐름(낱말 단위 줄바꿈)을 그대로 쓴다.
          <div className="flex min-h-0 flex-1 flex-col break-keep" data-invitation-chat-slot>
            {children}
          </div>
        ) : (
          <>
            <ExampleChatLines lines={model.chat} onAction={onChatAction} />
            <div className="flex-1" />
            <ChatComposer suggestions={model.suggestions} onSuggestion={onSuggestion} onSend={onSend} />
          </>
        )}
      </section>

      <section
        aria-label={WEB_COPY.spaceRegion}
        className={cx(
          "flex min-w-0 flex-[999_1_560px] flex-col gap-[22px] bg-inv-paper-panel px-[clamp(20px,3vw,44px)] pt-6 pb-10",
          INVITATION_DESCENDANT_WRAP,
        )}
      >
        {/* 아티팩트의 최소 높이 330px 는 안쪽 여백(위아래 36)을 뺀 값이라(content-box) 바깥 높이는 402px 이다. */}
        <div className="relative flex min-h-[402px] items-center justify-center overflow-hidden rounded-[32px] px-5 py-9">
          {/* eslint-disable-next-line @next/next/no-img-element -- 화면 바탕 사진이라 원본을 그대로 쓴다 */}
          <img src={INVITATION_BACKDROP_SRC} alt="" className="absolute inset-0 h-full! w-full object-cover" />
          <InvitationCard facts={model.invitation} variant="web" />
        </div>

        {notices}

        <div role="tablist" aria-label={WEB_COPY.tabsLabel} className="flex flex-wrap gap-1">
          {WEB_COPY.tabs.map((option, index) => {
            const on = option.id === tab;
            return (
              <Button
                key={option.id}
                ref={(element: HTMLButtonElement | null) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                id={tabId(option.id)}
                aria-selected={on}
                aria-controls={panelId(option.id)}
                tabIndex={on ? 0 : -1}
                variant={on ? "ink" : "plain"}
                size="pill-42"
                weight={on ? "medium" : "regular"}
                className="px-[18px]"
                onClick={() => setTab(option.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>

        <div {...panelProps("today")}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
            <article className={cx("flex flex-col gap-1", CARD)}>
              <h2 className="mb-2 font-inv-serif text-[18px] font-bold">{WEB_COPY.decisionsHeading}</h2>
              <DecisionRows decisions={decisions} variant="web" resolveRoute={resolveRoute} lead={leadDecision} />
              {model.decisions.length === 0 ? emptyStates?.decisions : null}
            </article>
            <article className={cx("flex flex-col gap-3", CARD)}>
              <h2 className="font-inv-serif text-[18px] font-bold">{WEB_COPY.activityHeading}</h2>
              {model.activity.length > 0 ? (
                <ol className="flex flex-col gap-3 text-[14px] leading-[1.55]">
                  {model.activity.map((item) => {
                    const actor = activityActor(item);
                    return (
                      <li key={`${item.timeLabel}-${item.text}`} className="flex gap-3.5" data-actor={actor ?? undefined}>
                        <span className="w-11 flex-none font-inv-numeral text-[16px] text-inv-gold-ink">{item.timeLabel}</span>
                        {actor ? (
                          <span>
                            <span className="text-inv-muted">{`${ACTIVITY_COPY.actorLabel[actor]} · `}</span>
                            {item.text}
                          </span>
                        ) : (
                          item.text
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                emptyStates?.activity ?? <ol className="flex flex-col gap-3 text-[14px] leading-[1.55]" />
              )}
            </article>
          </div>
        </div>

        <div {...panelProps("halls")}>
          {model.halls.length === 0 ? emptyStates?.halls : null}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[18px]">
            {model.halls.map((hall) => {
              const src = hall.photo ? photoSrc(hall.photo) : null;
              return (
                <article key={hall.id} className="flex flex-col gap-3" data-hall={hall.id}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 카드 폭에 맞춘 작은 사진이라 원본을 그대로 쓴다
                    <img
                      src={src}
                      alt={COMPARE_COPY.photoAlt(hall.name)}
                      className="block h-[170px]! w-full rounded-[22px] object-cover"
                    />
                  ) : null}
                  <div className="flex items-end justify-between px-1">
                    <div className="flex flex-col gap-0.5">
                      <strong className="font-inv-serif text-[18px]">{hall.name}</strong>
                      {hall.status ? <span className="text-[13px] text-inv-muted">{hall.status}</span> : null}
                    </div>
                    {hall.totalManwon ? (
                      <span className="font-inv-numeral text-[26px] font-medium">
                        {hall.totalManwon}
                        <span className="font-inv-sans text-[12px]">{` ${COMPARE_COPY.manwon}`}</span>
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div {...panelProps("plan")}>
          {model.plan.length === 0 ? emptyStates?.plan : null}
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            {model.plan.map((step) => (
              <li
                key={step.number}
                data-now={step.now}
                className={cx(
                  "flex flex-col gap-1 rounded-[22px] p-[18px]",
                  step.now ? "bg-inv-step-now" : "bg-inv-white shadow-[0_0_0_1px_#EEEAE6]",
                )}
              >
                <span className="font-inv-numeral text-[22px] text-inv-gold-ink">{step.number}</span>
                <strong className="text-[15px] font-medium">{step.title}</strong>
                <span className="text-[13px] text-inv-muted">{step.sub}</span>
              </li>
            ))}
          </ol>
        </div>
        {footer}
      </section>
    </div>
  );
}
