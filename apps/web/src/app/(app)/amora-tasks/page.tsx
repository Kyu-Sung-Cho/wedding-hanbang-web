import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AMORA_TASK_COPY } from "@hanbang/shared/amora-tasks";

export const metadata: Metadata = { title: `${AMORA_TASK_COPY.homeTitle} | 웨딩한방` };

/**
 * 맡은 일 목록은 홈("아모라가 맡은 일")에 있다. 이 주소는 결과 화면(`amora-tasks/[id]`)의 부모라 리라이트
 * 목록(`weddingAppRoutes.ts`)에 오르고, 목록의 이름은 실제로 열리는 페이지를 가져야 한다
 * (`weddingAppRoutes.test.ts`). 그래서 홈으로 보낸다.
 */
export default function AmoraTasksPage() {
  redirect("/wedding/lounge");
}
