import Markdown from "react-markdown";

export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <Markdown
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold tracking-tight">{children}</h1>
          ),
          h2: ({ children }) => <h2 className="text-lg font-medium tracking-tight">{children}</h2>,
          h3: ({ children }) => <h3 className="font-medium">{children}</h3>,
          p: ({ children }) => <p className="text-muted-foreground">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">{children}</ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => (
            <strong className="font-medium text-foreground">{children}</strong>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
