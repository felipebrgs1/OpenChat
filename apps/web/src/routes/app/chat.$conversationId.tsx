import type { MeResponse } from "@nexo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { z } from "zod";

import { ChatThread } from "@/components/chat/thread";
import { api } from "@/lib/api";

const searchSchema = z.object({
  prompt: z.string().optional(),
  starterId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/app/chat/$conversationId")({
  validateSearch: searchSchema,
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const { prompt, starterId } = Route.useSearch();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
  });

  if (me.data && !me.data.user.onboardedAt) {
    return <Navigate to="/app" />;
  }

  return (
    <ChatThread
      conversationId={conversationId}
      initialPrompt={prompt}
      initialStarterId={starterId}
    />
  );
}
