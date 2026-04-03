import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[22px] border border-slate-300/10 bg-[linear-gradient(180deg,rgba(10,17,27,0.9),rgba(13,21,33,0.96))] p-4 shadow-[0_22px_60px_rgba(0,0,0,0.36)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="m-0 text-base font-semibold text-slate-50">{title}</h2>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
