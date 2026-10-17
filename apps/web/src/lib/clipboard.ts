/**
 * 클립보드에 글을 넣는다. 클립보드 API 가 막힌 환경(비보안 컨텍스트, 일부 인앱 브라우저)에서는
 * 숨긴 textarea 를 골라 execCommand("copy") 를 한 번 더 해 본다.
 *
 * 초대 코드 패널(components/invite/InviteCodePanel.tsx)과 웨딩코드 64문항 둘이 같이 보기
 * (components/weddingCode64/Compare64.tsx)가 같이 쓴다. 화면마다 대비 코드가 따로 있으면
 * "어떤 화면에서는 복사가 된다"는 재현 안 되는 제보가 남아서 한 벌만 둔다.
 * 숨긴 칸은 성공·실패와 관계없이 늘 지운다.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    let area: HTMLTextAreaElement | null = null;
    try {
      area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      return document.execCommand("copy") === true;
    } catch {
      return false;
    } finally {
      area?.remove();
    }
  }
}
