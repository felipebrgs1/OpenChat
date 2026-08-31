import { cn } from "@nexo/ui/lib/utils";

function initials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserAvatar({
  name,
  email,
  className,
}: {
  name?: string | null;
  email?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background",
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}
