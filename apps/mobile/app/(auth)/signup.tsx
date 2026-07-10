import SecureWebEmailAuth from "@/components/SecureWebEmailAuth";

export default function SignupScreen() {
  return (
    <SecureWebEmailAuth
      mode="signup"
      title="회원가입"
      description="계정을 안전하게 만들 수 있도록 보안 확인이 가능한 웨딩한방 웹 화면으로 연결해드릴게요."
      buttonLabel="웹에서 회원가입 계속하기"
    />
  );
}
