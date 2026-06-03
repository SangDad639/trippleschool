import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-[#2A2A2A] bg-[#1B1B1B] px-3 py-2 text-base text-[#F0F0F0] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[#F0F0F0] placeholder:text-[#A8A8A8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB300] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
