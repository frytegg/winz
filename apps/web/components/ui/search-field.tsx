"use client";

import { Search } from "lucide-react";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

interface SearchFieldProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /** Read by screen readers: the field has no visible label. */
  label: string;
}

/** A pill search box with a magnifier (M3). 16px text so iOS does not zoom into it. */
export function SearchField({ label, className, ...input }: SearchFieldProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-12 items-center gap-3 rounded-full border border-stroke px-4",
        "transition-colors duration-150 ease-out",
        "has-[input:focus-visible]:border-lime has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-1 has-[input:focus-visible]:outline-lime",
        className,
      )}
    >
      <Search className="size-5 shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
        {...input}
      />
    </div>
  );
}
