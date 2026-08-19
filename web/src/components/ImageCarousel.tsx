import { CSSProperties, useRef, useState } from "react";

export interface CarouselImage {
  key: string | number;
  src: string;
  alt: string;
}

const ARROW_BASE: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 32,
  height: 32,
  borderRadius: "50%",
  border: 0,
  background: "rgba(0,0,0,0.5)",
  color: "#fff",
  fontSize: 20,
  lineHeight: 1,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * Galeri gambar ala Facebook/Instagram (2026-08-19, instruksi eksplisit user)
 * -- postingan dengan >1 gambar TIDAK ditumpuk vertikal (dulu harus scroll ke
 * bawah utk lihat semua), tapi digeser horizontal 1 layar per gambar (swipe di
 * HP via native scroll-snap, panah kiri/kanan + titik indikator di desktop).
 * Sengaja tanpa library carousel eksternal -- cuma horizontal scroll-snap
 * polos + `scrollIntoView`, cukup ringan utk kebutuhan feed Papan Info.
 */
export default function ImageCarousel({ images }: { images: CarouselImage[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function scrollToIndex(i: number) {
    const clamped = Math.max(0, Math.min(images.length - 1, i));
    const scroller = scrollerRef.current;
    const child = scroller?.children[clamped] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    setIndex(clamped);
  }

  /** Titik indikator & panah ikut update kalau user swipe manual (bukan cuma klik panah) --
   * deteksi gambar mana yg paling dekat ke sisi kiri kotak scroll saat ini. */
  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerLeft = scroller.getBoundingClientRect().left;
    let closest = 0;
    let closestDist = Infinity;
    [...scroller.children].forEach((child, i) => {
      const dist = Math.abs((child as HTMLElement).getBoundingClientRect().left - scrollerLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setIndex(closest);
  }

  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <img
        src={images[0].src}
        alt={images[0].alt}
        style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }}
      />
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="image-carousel-scroller"
        style={{
          display: "flex",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      >
        {images.map((img) => (
          <img
            key={img.key}
            src={img.src}
            alt={img.alt}
            style={{
              flex: "0 0 100%",
              width: "100%",
              maxHeight: 480,
              objectFit: "contain",
              scrollSnapAlign: "start",
              background: "#0f172a",
            }}
          />
        ))}
      </div>

      {index > 0 && (
        <button type="button" onClick={() => scrollToIndex(index - 1)} aria-label="Gambar sebelumnya" style={{ ...ARROW_BASE, left: 8 }}>
          ‹
        </button>
      )}
      {index < images.length - 1 && (
        <button type="button" onClick={() => scrollToIndex(index + 1)} aria-label="Gambar berikutnya" style={{ ...ARROW_BASE, right: 8 }}>
          ›
        </button>
      )}

      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          padding: "1px 8px",
          borderRadius: 10,
        }}
      >
        {index + 1}/{images.length}
      </div>

      <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5 }}>
        {images.map((img, i) => (
          <button
            key={img.key}
            type="button"
            aria-label={`Ke gambar ${i + 1}`}
            onClick={() => scrollToIndex(i)}
            style={{
              width: 7,
              height: 7,
              padding: 0,
              borderRadius: "50%",
              border: 0,
              cursor: "pointer",
              background: i === index ? "#fff" : "rgba(255,255,255,0.55)",
              boxShadow: "0 0 2px rgba(0,0,0,0.6)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
