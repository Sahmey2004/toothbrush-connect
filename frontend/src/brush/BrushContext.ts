import { createContext, useContext } from "react";

// The shared brush session, provided by <BrushLayout> so it survives the /start → /feed move.
export type Brush = ReturnType<typeof import("../hooks/useSession").useSession>;

export const BrushContext = createContext<Brush | null>(null);

export function useBrush(): Brush {
  const ctx = useContext(BrushContext);
  if (!ctx) throw new Error("useBrush must be used inside <BrushLayout>");
  return ctx;
}
