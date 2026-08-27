"use client";

import { usePathname } from "next/navigation";
import TradingTerminal, { type ActiveTab } from "./trading-terminal";

const routeTabs: Record<string, ActiveTab> = {
  "/": "workspace",
  "/history": "history",
  "/bots": "bots",
  "/analyzer": "analyzer",
  "/portfolio": "portfolio",
  "/risk": "risk",
  "/settings": "settings",
};

/** Keeps the authenticated Deriv WebSocket mounted while App Router pages change. */
export default function TerminalShell() {
  const pathname = usePathname();
  return <TradingTerminal initialTab={routeTabs[pathname] ?? "workspace"} />;
}
