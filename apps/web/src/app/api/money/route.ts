import { congratulatoryMoneyRetiredResponse } from "./retiredResponse";

/** 신규 조회와 수집은 인증·본문·데이터베이스 접근 전에 종료한다. */
export async function GET() {
  return congratulatoryMoneyRetiredResponse();
}

export async function POST() {
  return congratulatoryMoneyRetiredResponse();
}
