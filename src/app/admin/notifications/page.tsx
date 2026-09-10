import { redirect } from "next/navigation";

/** Legacy route — the announcements page is now Broadcast (with history). */
export default function AdminNotificationsRedirect() {
  redirect("/admin/broadcast");
}
