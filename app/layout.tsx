import type { Metadata } from "next";
import "./globals.css";
import Providers from "../components/providers";
import TerminalShell from "../components/terminal-shell";

export const metadata: Metadata = {
  title: "DTrader · Last Digit Options",
  description: "A focused Deriv options trading workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TerminalShell />
          {children}
        </Providers>
      </body>
    </html>
  );
}
