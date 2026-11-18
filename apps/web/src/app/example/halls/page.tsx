import type { Metadata } from "next";

import { EXAMPLE_PAGE_TITLES } from "../exampleRoutes";
import ExampleHallsClient from "./ExampleHallsClient";

export const metadata: Metadata = { title: EXAMPLE_PAGE_TITLES.compare };

export default function ExampleHallsPage() {
  return <ExampleHallsClient />;
}
