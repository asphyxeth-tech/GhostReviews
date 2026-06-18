import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { AdminDashboard } from "@/components/AdminDashboard";

// Dev-only prospecting dashboard. Gated to the ADMIN_EMAILS allowlist — anyone
// else (signed in or not) gets a 404, so the route's existence isn't revealed.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();
  return <AdminDashboard email={admin.email} />;
}
