import type * as React from "react";

import { cn } from "../lib/utils";

export interface OraculoLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  variant?: "glyph" | "badge" | "full";
}

/**
 * Minimalist Oráculo Icon
 * Combines the letter 'O' with a sleek geometric oracle lens / pupil.
 */
export function OraculoIcon({
  size = 24,
  className,
  ...props
}: React.SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      aria-hidden="true"
      {...props}
    >
      {/* Outer 'O' ring */}
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Oracle eye lens */}
      <path
        d="M 6.5 12 C 8.5 8.5, 15.5 8.5, 17.5 12 C 15.5 15.5, 8.5 15.5, 6.5 12 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Focal pupil / oracle core */}
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

/**
 * Minimalist Oráculo Badge (Squircle container with inverted glyph)
 */
export function OraculoBadge({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClasses = {
    sm: "size-7 rounded-lg text-xs",
    md: "size-8 rounded-xl text-sm",
    lg: "size-10 rounded-2xl text-base",
  };

  const iconSizes = {
    sm: 14,
    md: 17,
    lg: 21,
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center bg-foreground text-background shadow-xs transition-transform active:scale-95",
        sizeClasses[size],
        className,
      )}
    >
      <OraculoIcon size={iconSizes[size]} />
    </span>
  );
}

/**
 * Full Oráculo Logo (Icon + Wordmark)
 */
export function OraculoLogo({ variant = "glyph", size, className, ...props }: OraculoLogoProps) {
  if (variant === "badge") {
    return <OraculoBadge className={className} />;
  }

  if (variant === "full") {
    return (
      <div className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
        <OraculoIcon size={size ?? 22} {...props} />
        <span>Oráculo</span>
      </div>
    );
  }

  return <OraculoIcon size={size} className={className} {...props} />;
}
