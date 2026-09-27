"use client";

import type React from 'react';
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "group toast border border-slate-200 bg-white text-slate-900 shadow-lg",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
