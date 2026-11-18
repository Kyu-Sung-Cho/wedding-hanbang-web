import type { Metadata } from "next";

import { EXAMPLE_PAGE_TITLES } from "../../exampleRoutes";
import ExampleLetterClient from "./ExampleLetterClient";

export const metadata: Metadata = { title: EXAMPLE_PAGE_TITLES.letter };

export default function ExampleLetterPage() {
  return <ExampleLetterClient />;
}
