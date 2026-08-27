import { notFound } from "next/navigation";
import type { ActiveTab } from "../../components/trading-terminal";

const validSections = new Set<ActiveTab>(["history", "bots", "analyzer", "portfolio", "risk", "settings"]);

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!validSections.has(section as ActiveTab)) notFound();
  return null;
}
