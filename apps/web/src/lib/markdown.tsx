import Markdown from "react-markdown";

export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-7 text-foreground">
      <Markdown
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
          ),
          h3: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-foreground underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-foreground/20 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-5">
              {children}
            </pre>
          ),
          code: ({ children, className }) => {
            if (className) {
              return <code className={className}>{children}</code>;
            }
            return (
              <code className="rounded-md bg-muted px-1.5 py-0.5 text-[13px]">{children}</code>
            );
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
