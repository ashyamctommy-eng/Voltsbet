"use client";

import { ContentManager } from "@/components/admin/ContentManager";

export default function AdminTestimonials() {
  return (
    <ContentManager
      endpoint="/api/admin/testimonials"
      title="Testimonials"
      fields={[
        { name: "name", label: "Customer name" },
        { name: "avatar", label: "Avatar URL" },
        { name: "rating", label: "Rating (1–5)", type: "number" },
        { name: "text", label: "Testimonial text", type: "textarea" },
        { name: "status", label: "Status", placeholder: "PENDING / APPROVED / HIDDEN" },
        { name: "sortOrder", label: "Sort order", type: "number" },
      ]}
      columns={[
        { key: "name", label: "Name" },
        { key: "rating", label: "Rating", render: (r) => <span className="text-amber-400">{"★".repeat(Number(r.rating) || 0)}</span> },
        { key: "status", label: "Status", render: (r) => (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "APPROVED" ? "bg-green-500/15 text-green-400" : r.status === "PENDING" ? "bg-amber-500/15 text-amber-400" : "bg-gray-500/15 text-gray-400"}`}>
            {String(r.status)}
          </span>
        )},
      ]}
    />
  );
}
