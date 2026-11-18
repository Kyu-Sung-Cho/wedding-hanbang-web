import type { Metadata } from "next";

import { EXAMPLE_PAGE_TITLES } from "../exampleRoutes";
import ExampleChatClient from "./ExampleChatClient";

export const metadata: Metadata = { title: EXAMPLE_PAGE_TITLES.chat };

export default function ExampleChatPage() {
  return <ExampleChatClient />;
}
