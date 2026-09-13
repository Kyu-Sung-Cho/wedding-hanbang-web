import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChatBubble from "./ChatBubble";
import type { ChatMessage } from "@/types/database.types";
const message:ChatMessage={id:"message",couple_id:"couple",sender_id:"owner",sender_role:"bride",visibility:"shared",content:"확인한 내용",metadata:{},created_at:"2026-09-13T00:00:00Z"};
describe("confirmed author chat colors",()=>{
  it.each([true,false])("uses selected groom/sky and bride/rose regardless of signup slot or side: own=%s",own=>{
    for(const [role,tone] of [["groom","sky"],["bride","rose"],[null,"neutral"]] as const){
      const html=renderToStaticMarkup(<ChatBubble message={message} isCurrentUser={own} senderConfirmedRole={role}/>);
      expect(html).toContain(`hb-chat-${tone}-surface`);expect(html).toContain(`hb-chat-${tone}-ink`);
      expect(html).toContain("확인한 내용");expect(html).not.toContain("text-white");
    }
  });
  it("keeps unknown authors neutral and personal/partner labels without overriding their author's color",()=>{
    expect(renderToStaticMarkup(<ChatBubble message={{...message,sender_id:null}} isCurrentUser={false} senderConfirmedRole="groom"/>)).toContain("hb-chat-neutral-surface");
    const personal=renderToStaticMarkup(<ChatBubble message={{...message,visibility:"bride_private"}} isCurrentUser senderConfirmedRole="groom"/>);
    expect(personal).toContain("hb-chat-sky-surface");expect(personal).toContain("나만 보기");
    const direct=renderToStaticMarkup(<ChatBubble message={{...message,metadata:{target:"partner"}}} isCurrentUser senderConfirmedRole="bride"/>);
    expect(direct).toContain("hb-chat-rose-surface");expect(direct).toContain("상대방에게");
  });
  it("keeps AI sage even when a caller supplies a human role",()=>{
    const html=renderToStaticMarkup(<ChatBubble message={{...message,sender_role:"ai",sender_id:null}} isCurrentUser={false} senderConfirmedRole="groom"/>);
    expect(html).toContain("hb-chat-amora-surface");expect(html).not.toContain("hb-chat-sky-surface");
  });
  it("shows the current partner avatar with their selected role color, and drops unknown-author avatars",()=>{
    const known=renderToStaticMarkup(<ChatBubble message={message} isCurrentUser={false} senderConfirmedRole="groom" senderAvatarUrl="🌷"/>);
    expect(known).toContain("hb-chat-sky-surface");expect(known).toContain('data-profile-avatar="emoji"');expect(known).toContain("🌷");
    const unknown=renderToStaticMarkup(<ChatBubble message={{...message,sender_id:null}} isCurrentUser={false} senderConfirmedRole="groom" senderAvatarUrl="🌷"/>);
    expect(unknown).toContain("hb-chat-neutral-surface");expect(unknown).not.toContain('data-profile-avatar="emoji"');
  });
});
