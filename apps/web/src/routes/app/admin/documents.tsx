import { createFileRoute } from "@tanstack/react-router";

import { DocumentPanel } from "@/components/knowledge/document-panel";

export const Route = createFileRoute("/app/admin/documents")({
  component: () => <DocumentPanel mode="all" />,
});
