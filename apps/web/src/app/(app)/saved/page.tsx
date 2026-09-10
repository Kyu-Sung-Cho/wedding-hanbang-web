import { redirect } from "next/navigation";

export default function SavedNotesPage() {
  redirect("/wedding/chat/board?view=saved");
}
