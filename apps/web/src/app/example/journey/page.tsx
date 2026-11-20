import type { Metadata } from "next";

import { EXAMPLE_PAGE_TITLES } from "../exampleRoutes";
import ExampleJourneyClient from "./ExampleJourneyClient";

export const metadata: Metadata = { title: EXAMPLE_PAGE_TITLES.journey };

export default function ExampleJourneyPage() {
  return <ExampleJourneyClient />;
}
