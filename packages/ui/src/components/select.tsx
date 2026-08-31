import { cn } from "@nexo/ui/lib/utils";
import * as React from "react";

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:bg-card dark:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
