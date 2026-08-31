import type { Conversation } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { cn } from "@nexo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { MessageSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export function ConversationList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const list = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<{ conversations: Conversation[] }>("/api/conversations"),
    retry: false,
  });
  const conversations = list.data?.conversations ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/conversations/${id}`, { method: "DELETE" }),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (pathname.includes(id)) {
        await navigate({ to: "/app/chat" });
      }
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Não foi possível apagar.");
    },
  });

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
        <div key={conversation.id} className="group relative flex items-center">
          <Link
            to="/app/chat/$conversationId"
            params={{ conversationId: conversation.id }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-[13px] text-sidebar-foreground/80",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "[&.active]:bg-sidebar-accent [&.active]:font-medium [&.active]:text-sidebar-accent-foreground",
            )}
          >
            <MessageSquare className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{conversation.title || "Nova conversa"}</span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 rounded-md text-sidebar-foreground/70 opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent hover:text-destructive"
            aria-label="Apagar conversa"
            disabled={remove.isPending}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              remove.mutate(conversation.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
