import type { Conversation } from "@nexo/contracts";
import { cn } from "@nexo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

import { api } from "@/lib/api";

export function ConversationList() {
  const list = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<{ conversations: Conversation[] }>("/api/conversations"),
    retry: false,
  });
  const conversations = list.data?.conversations ?? [];

  if (list.isLoading) {
    return (
      <div className="space-y-1 px-2">
        <div className="h-9 animate-pulse rounded-lg bg-sidebar-accent/70" />
        <div className="h-9 animate-pulse rounded-lg bg-sidebar-accent/50" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="px-3 py-2 text-xs leading-5 text-sidebar-foreground/55">
        Nenhuma conversa ainda. Comece uma nova.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
      {conversations.map((conversation) => (
        <Link
          key={conversation.id}
          to="/app/chat/$conversationId"
          params={{ conversationId: conversation.id }}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-sidebar-foreground/80",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            "[&.active]:bg-sidebar-accent [&.active]:font-medium [&.active]:text-sidebar-accent-foreground",
          )}
        >
          <MessageSquare className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{conversation.title || "Nova conversa"}</span>
        </Link>
      ))}
    </div>
  );
}
