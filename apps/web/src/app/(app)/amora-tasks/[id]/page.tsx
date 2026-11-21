import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AMORA_TASK_COPY, AMORA_TASK_ID_PATTERN } from "@hanbang/shared/amora-tasks";

import AmoraTaskDetailView from "@/components/amoraTasks/AmoraTaskDetailView";

export const metadata: Metadata = { title: `${AMORA_TASK_COPY.homeTitle} | 웨딩한방` };

/**
 * 아모라가 맡은 일의 결과 화면(`/wedding/amora-tasks/<id>`). 홈의 "아모라가 맡은 일"과 대화 카드의 진행 보기가 연다.
 * 로그인 확인은 (app) 틀이 하고, 결과는 화면이 `GET /api/amora/tasks/<id>` 로 읽는다(그 커플 회원만 읽힌다).
 * 주소의 id 가 맡은 일 id 모양이 아니면 없는 화면이다.
 */
export default async function AmoraTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!AMORA_TASK_ID_PATTERN.test(id)) notFound();
  return <AmoraTaskDetailView taskId={id.toLowerCase()} />;
}
