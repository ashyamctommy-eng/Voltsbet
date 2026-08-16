"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Banner = {
  id: string;
  title: string | null;
  description: string | null;
  image: string;
  ctaText: string | null;
  ctaUrl: string | null;
};

const GRADIENTS = [
  "linear-gradient(120deg, #0e2a1f 0%, #123b5e 55%, #1a1050 100%)",
  "linear-gradient(120deg, #1c0e33 0%, #3b1d63 50%, #0e2a4d 100%)",
  "linear-gradient(120deg, #0f2a3f 0%, #0e4d3a 50%, #14203f 100%)",
];

export default function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [idx, setIdx] = useState(0);
  const n = banners.length;

  useEffect(() => {
    if (n <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % n), 6000);
    return () => clearInterval(t);
  }, [n]);

  if (n === 0) return null;

  const b = banners[idx];

  return (
    <div className="relative h-[240px] overflow-hidden rounded-2xl border border-line sm:h-[300px] lg:h-[340px]">
      {banners.map((bn, i) => (
        <div
          key={bn.id}
          className={`absolute inset-0 transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-0"}`}
          style={{ background: GRADIENTS[i % GRADIENTS.length] }}
        >
          {bn.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bn.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
          )}
          <div className="absolute inset-0 flex flex-col justify-center p-8 sm:p-12">
            <h2 className="max-w-xl text-2xl font-extrabold leading-tight sm:text-4xl">{bn.title}</h2>
            {bn.description && <p className="mt-2 max-w-lg text-sm text-ink2 sm:text-base">{bn.description}</p>}
            {bn.ctaText && (
              <Link href={bn.ctaUrl ?? "/"} className="btn btn-primary mt-5 w-fit">
                {bn.ctaText}
              </Link>
            )}
          </div>
        </div>
      ))}
      {n > 1 && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
          {banners.map((_, i) => (
            <button
              key={i}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-brand" : "w-1.5 bg-white/25"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
