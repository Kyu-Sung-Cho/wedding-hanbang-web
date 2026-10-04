/**
 * 웨딩코드 4.0 화면 묶음의 입구. 클라이언트(app/wedding-code/WeddingCodeV40Client.tsx)가 여기서 화면을 가져온다.
 * 입력 컴포넌트(PairInput 등)는 질문 화면이 안에서 쓰므로 내지 않는다.
 */
export { IntroScreen, type AutosavePreference, type IntroScreenProps } from "./IntroScreen";
export { QuestionScreen, type QuestionScreenProps } from "./QuestionScreen";
export { RestCard } from "./RestCard";
export { SelfIntroCard } from "./SelfIntroCard";
export { ReceiverScreen } from "./ReceiverScreen";
export {
  BoundaryFallbackScreen,
  BrokenLinkScreen,
  NoCompareScreen,
  PositionGateScreen,
  SelfLinkScreen,
  StorageNotice,
  type SaveState,
  type StorageProblem,
} from "./NoticeScreens";
export { ResultScreen, type ResultScreenProps } from "./ResultScreen";
export { CoupleResult, type CoupleResultProps, type CoupleSendConfig } from "./CoupleResult";
export { ShareBlock, type ShareBlockSentEvent } from "./ShareBlock";
export { browserShareEnv, isRealClipboardCopy, type ShareEnv, type ShareSentEvent } from "./shareActions";
export { screenRootClass } from "./SectionCard";
export { useScreenFocus } from "./useScreenFocus";
export { cx, noteText } from "./styles";
