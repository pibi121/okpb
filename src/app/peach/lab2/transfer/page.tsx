import { requireUser } from "@/lib/auth";
import { Lab2TransferClient } from "@/components/lab2-transfer-client";

export default async function Lab2TransferPage() {
  const user = await requireUser();
  if (!user) return null;

  return <Lab2TransferClient />;
}
