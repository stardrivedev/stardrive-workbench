"use client";

import { useState } from "react";
import Image from "next/image";

/** Fill image with a shimmer placeholder while loading. Parent must be relative. */
export default function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <div className="d4-skeleton absolute inset-0" />}
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-contain p-4 transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
