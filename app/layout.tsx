import type { Metadata } from "next";
import "./globals.css";
import TerminalShell from "../components/terminal-shell";

export const metadata: Metadata = {
  title: "DTrader · Last Digit Options",
  description: "A focused Deriv options trading workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TerminalShell />
        {children}
      </body>
    </html>
  );
}
