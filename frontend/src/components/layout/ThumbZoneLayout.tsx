import type { ReactNode } from "react";

// PRD "Companion app screen layout": read-only top, every control in the bottom 45%.
export function ThumbZoneLayout({ status, display, action, utility }: {
  status: ReactNode; display: ReactNode; action: ReactNode; utility?: ReactNode;
}) {
  return (
    <div className="thumb">
      <div className="thumb__status">{status}</div>
      <div className="thumb__display">{display}</div>
      <div className="thumb__action">{action}</div>
      {utility && <div className="thumb__utility">{utility}</div>}
    </div>
  );
}
