import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

type ButtonVariant = "default" | "ghost" | "danger";
type ButtonSize = "default" | "compact";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "border border-sky-200/20 bg-[linear-gradient(180deg,rgba(71,120,184,0.24),rgba(45,78,126,0.22))] text-slate-50 shadow-sm hover:border-sky-200/35",
  ghost: "border border-slate-200/10 bg-white/5 text-slate-100 hover:border-slate-200/20",
  danger: "border border-rose-400/35 bg-rose-500/10 text-rose-100 hover:border-rose-300/45",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-11 rounded-full px-4 text-sm",
  compact: "h-9 rounded-full px-3.5 text-sm",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition disabled:pointer-events-none disabled:opacity-45",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
