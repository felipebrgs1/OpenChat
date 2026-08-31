import { createFileRoute, redirect } from "@tanstack/react-router";

import { authDisabled } from "@/lib/flags";
import { getSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      to: authDisabled() || getSession()?.accessToken ? "/app" : "/login",
    });
  },
});
