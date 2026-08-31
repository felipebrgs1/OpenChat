import { Button } from "@nexo/ui/components/button";
import { cn } from "@nexo/ui/lib/utils";
import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent } from "react";

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming = false,
  disabled = false,
  placeholder = "Pergunte ao Nexo",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const canSend = value.trim().length > 0 && !disabled && !streaming;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) {
      return;
    }
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
      <div
        className={cn(
          "rounded-3xl border border-border/80 bg-background shadow-[0_8px_30px_rgba(0,0,0,0.06)]",
          "focus-within:border-ring/60 focus-within:shadow-[0_10px_36px_rgba(0,0,0,0.08)]",
          "dark:bg-card dark:shadow-none",
        )}
      >
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className="field-sizing-content max-h-48 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <p className="px-2 text-[11px] text-muted-foreground">
            Enter envia · Shift+Enter quebra linha
          </p>
          {streaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="rounded-full"
              onClick={onStop}
              aria-label="Parar"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="rounded-full"
              disabled={!canSend}
              aria-label="Enviar"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        O Nexo pode errar. Confira procedimento interno antes de agir.
      </p>
    </form>
  );
}
