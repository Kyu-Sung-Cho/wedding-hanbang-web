import type { Metadata } from "next";

import { EXAMPLE_PAGE_TITLES } from "../exampleRoutes";
import ExampleConsultationClient from "./ExampleConsultationClient";

export const metadata: Metadata = { title: EXAMPLE_PAGE_TITLES.status };

export default function ExampleConsultationPage() {
  return <ExampleConsultationClient />;
}
