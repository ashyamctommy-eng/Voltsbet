"use client";

import { ContentManager } from "@/components/admin/ContentManager";

export default function AdminPromotions() {
  return (
    <ContentManager
      endpoint="/api/admin/promotions"
      title="Promotions"
      fields={[
        { name: "title", label: "Title" },
        { name: "description", label: "Description", type: "textarea" },
        { name: "bonusType", label: "Bonus type", placeholder: "WELCOME_BONUS / DEPOSIT_BONUS / FREE_BET / ACCA_PROMO" },
        { name: "bonusValue", label: "Bonus value", type: "number" },
        { name: "terms", label: "Terms", type: "textarea" },
        { name: "image", label: "Image URL" },
        { name: "startAt", label: "Start date (ISO)" },
        { name: "endAt", label: "End date (ISO)" },
        { name: "sortOrder", label: "Sort order", type: "number" },
        { name: "active", label: "Active", type: "checkbox" },
      ]}
      columns={[
        { key: "title", label: "Title" },
        { key: "bonusType", label: "Type", render: (r) => <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">{String(r.bonusType ?? "PROMO")}</span> },
        { key: "active", label: "Status", render: (r) => <span className={`text-xs font-bold ${r.active ? "text-green-400" : "text-red-400"}`}>{r.active ? "ACTIVE" : "INACTIVE"}</span> },
      ]}
    />
  );
}
