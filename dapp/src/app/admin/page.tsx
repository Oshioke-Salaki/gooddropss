import { redirect } from "next/navigation";

// The old Overview (seed-drops dev tool) has been removed. Land the base admin
// URL on Analytics instead.
export default function AdminIndex() {
  redirect("/admin/analytics");
}
