"use client";

import { ContentManager } from "@/components/admin/ContentManager";

export default function AdminBanners() {
  return (
    <ContentManager
      endpoint="/api/admin/banners"
      title="Banners"
      fields={[
        { name: "title", label: "Title" },
        { name: "description", label: "Description", type: "textarea" },
        { name: "image", label: "Image URL (optional — gradient fallback)" },
        { name: "ctaText", label: "Button text" },
        { name: "ctaUrl", label: "Destination URL" },
        { name: "sortOrder", label: "Sort order", type: "number" },
        { name: "active", label: "Active", type: "checkbox" },
      ]}
      columns={[
        { key: "title", label: "Title" },
        { key: "ctaUrl", label: "Destination" },
        { key: "active", label: "Status", render: (r) => <span className={`text-xs font-bold ${r.active ? "text-green-400" : "text-red-400"}`}>{r.active ? "ACTIVE" : "INACTIVE"}</span> },
      ]}
    />
  );
}
