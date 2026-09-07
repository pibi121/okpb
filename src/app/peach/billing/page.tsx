import { requireUser } from "@/lib/auth";
import { BillingPageClient } from "@/components/billing-page-client";

export default async function PeachBillingPage() {
  const user = await requireUser();
  if (!user) return null;

  return <BillingPageClient credits={user.credits} />;
}
