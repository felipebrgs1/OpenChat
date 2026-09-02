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
    meta: [
      { title: "Oráculo" },
      { name: "description", content: "Assistente interno inteligente" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "alternate icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
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
        storageKey="oraculo-theme"
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
