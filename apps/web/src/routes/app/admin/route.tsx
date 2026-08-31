import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authDisabled } from "@/lib/flags";
import { getSession } from "@/lib/session";

export const Route = createFileRoute("/app/admin")({
  beforeLoad: () => {
    if (!authDisabled() && !getSession()?.user.isAdmin) {
      throw redirect({ to: "/app" });
    }
  },
  component: () => <Outlet />,
});
