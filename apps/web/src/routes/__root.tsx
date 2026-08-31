import { Toaster } from "@nexo/ui/components/sonner";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

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
        <AuthProvider>
          <Outlet />
          <Toaster richColors />
        </AuthProvider>
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
    </>
  );
}
