import { createFileRoute } from "@tanstack/react-router";

import { DocumentPanel } from "@/components/knowledge/document-panel";

export const Route = createFileRoute("/app/documents")({
  component: () => <DocumentPanel mode="my" />,
});
