import { cn } from "../../lib/utils";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "text-slate-200",
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-rose-300",
  accent: "text-sky-200",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-slate-200/10 bg-white/5 px-3 py-1 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
