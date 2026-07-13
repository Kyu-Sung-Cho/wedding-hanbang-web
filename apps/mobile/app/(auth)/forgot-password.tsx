import SecureWebEmailAuth from "@/components/SecureWebEmailAuth";

export default function ForgotPasswordScreen() {
  return (
    <SecureWebEmailAuth
      mode="forgot"
      title="비밀번호 찾기"
      description="계정 존재 여부를 보호하면서 재설정 요청을 처리할 수 있도록 웨딩한방 웹 화면으로 연결해드릴게요."
      buttonLabel="웹에서 비밀번호 재설정하기"
    />
  );
}
