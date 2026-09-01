import { Toaster } from "@nexo/ui/components/sonner";
import { TooltipProvider } from "@nexo/ui/components/tooltip";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import * as React from "react";

const TanStackRouterDevtools = import.meta.env.DEV
  ? React.lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )
  : () => null;

import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";

import "../index.css";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [{ title: "Nexo" }, { name: "description", content: "Assistente interno" }],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        disableTransitionOnChange
        storageKey="nexo-theme"
      >
        <TooltipProvider>
          <AuthProvider>
            <Outlet />
            <Toaster richColors />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
      {import.meta.env.DEV ? (
        <React.Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-left" />
        </React.Suspense>
      ) : null}
    </>
  );
}
