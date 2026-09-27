"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "../utils.ts";

function Avatar({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-700",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback };
