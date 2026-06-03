import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border-2 border-[#2A2A2A] bg-[#1B1B1B] px-3 py-2 text-sm text-[#F0F0F0] placeholder:text-[#A8A8A8] transition-all duration-200 focus-visible:outline-none focus-visible:border-[#FFB300] focus-visible:shadow-[0_0_0_3px_rgba(255,179,0,0.4)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
