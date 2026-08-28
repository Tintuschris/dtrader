"use client";

import { DerivProvider } from "./deriv-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <DerivProvider>{children}</DerivProvider>;
}
