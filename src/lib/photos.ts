export interface Photo {
  thumbnail: string;
  large: string;
  link: string;
  photographer: string;
}
const photos = new Map<
  string,
  { expires: number; promise: Promise<Photo[]> }
>();
const TTL = 3600_000;

export function loadPhotos(hex: string): Promise<Photo[]> {
  hex = hex.toLowerCase();
  const cached = photos.get(hex);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const entry: { expires: number; promise: Promise<Photo[]> } = {
    expires: Infinity,
    promise: fetch("/api/photo/" + hex, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("photo_failed");
        return response.json();
      })
      .then((data) => {
        if (
          !data ||
          (!Array.isArray(data.photos) &&
            !Object.prototype.hasOwnProperty.call(data, "photo"))
        )
          throw new Error("invalid_photo");
        entry.expires = Date.now() + TTL;
        return Array.isArray(data.photos)
          ? (data.photos as Photo[])
          : data.photo
            ? [data.photo as Photo]
            : [];
      })
      .catch((error) => {
        if (photos.get(hex) === entry) photos.delete(hex);
        throw error;
      }),
  };
  photos.set(hex, entry);
  return entry.promise;
}
export function loadPhoto(hex: string): Promise<Photo | null> {
  return loadPhotos(hex).then((photos) => photos[0] ?? null);
}
