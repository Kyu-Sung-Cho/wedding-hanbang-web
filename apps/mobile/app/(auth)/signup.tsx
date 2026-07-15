import SecureWebEmailAuth from "@/components/SecureWebEmailAuth";
import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "@hanbang/shared";

export default function SignupScreen() {
  return (
    <SecureWebEmailAuth
      mode="signup"
      title="회원가입"
      description={`${PUBLIC_BETA_RELATIONSHIP_SCOPE.notice}\n\n${PUBLIC_BETA_RELATIONSHIP_SCOPE.guidance}\n\n계정을 안전하게 만들 수 있도록 보안 확인이 가능한 웨딩한방 웹 화면으로 연결해드릴게요.`}
      buttonLabel="웹에서 회원가입 계속하기"
    />
  );
}
