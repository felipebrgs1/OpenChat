import type { Conversation } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "@/lib/api";

export function ConversationList() {
  const list = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<{ conversations: Conversation[] }>("/api/conversations"),
    retry: false,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2">
      <Link to="/app/chat" className="block">
        <Button variant="outline" className="w-full">
          Nova conversa
        </Button>
      </Link>
      {list.data?.conversations.map((conversation) => (
        <Link
          key={conversation.id}
          to="/app/chat/$conversationId"
          params={{ conversationId: conversation.id }}
          className="truncate rounded-none px-2 py-1.5 text-sm hover:bg-muted [&.active]:bg-muted [&.active]:font-medium"
        >
          {conversation.title}
        </Link>
      ))}
    </div>
  );
}
