"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { loadPhotos, type Photo } from "@/lib/photos";
export default function PhotoCarousel({
  hex,
  registration,
}: {
  hex: string;
  registration?: string | null;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPhotos([]);
    setIndex(0);
    setFailed(new Set());
    void loadPhotos(hex)
      .catch(() => [])
      .then((result) => {
        if (active) {
          setPhotos(result);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [hex]);
  const photo = photos[index];
  return (
    <div className="photo-card" aria-label="Aircraft photos">
      {loading ? (
        <div className="photo-skeleton" aria-label="Loading aircraft photos" />
      ) : photo?.thumbnail && !failed.has(index) ? (
        <>
          <Image
            unoptimized
            src={photo.thumbnail}
            alt={
              registration ? "Aircraft " + registration : "Selected aircraft"
            }
            width={640}
            height={420}
            onError={() =>
              setFailed((previous) => new Set([...previous, index]))
            }
          />
          <a href={photo.link} target="_blank" rel="noreferrer">
            © {photo.photographer || "Planespotters.net"} ↗
          </a>
        </>
      ) : (
        <div className="photo-placeholder">
          <span>✈</span>
          <p>No photo available</p>
          <small>Aircraft photo</small>
        </div>
      )}
      {photos.length > 1 && (
        <>
          <button
            className="photo-arrow previous"
            aria-label="Previous photo"
            onClick={() =>
              setIndex((index + photos.length - 1) % photos.length)
            }
          >
            ‹
          </button>
          <button
            className="photo-arrow next"
            aria-label="Next photo"
            onClick={() => setIndex((index + 1) % photos.length)}
          >
            ›
          </button>
          <div className="photo-dots" aria-label="Choose photo">
            {photos.map((_, i) => (
              <button
                key={i}
                aria-label={`Photo ${i + 1} of ${photos.length}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
