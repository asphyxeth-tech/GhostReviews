import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { CostDashboard } from "@/components/CostDashboard";

// Owner cost cockpit — the infrastructure spend / subscription ledger. Admin-
// gated (404 for everyone else), same as the rest of /admin.
export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return <CostDashboard email={admin.email} />;
}
