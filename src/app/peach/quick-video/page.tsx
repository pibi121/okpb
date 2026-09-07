import { redirect } from "next/navigation";

export default function QuickVideoRedirectPage() {
  redirect("/peach/video?tab=create");
}
