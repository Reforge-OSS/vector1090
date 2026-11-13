interface Photo {
  thumbnail: string;
  large: string;
  link: string;
  photographer: string;
}
const photos = new Map<
  string,
  { expires: number; promise: Promise<Photo | null> }
>();
const TTL = 3600_000;

export function loadPhoto(hex: string): Promise<Photo | null> {
  const cached = photos.get(hex);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const entry: { expires: number; promise: Promise<Photo | null> } = {
    expires: Infinity,
    promise: fetch("/api/photo/" + hex, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("photo_failed");
        return response.json();
      })
      .then((data) => {
        if (!data || !Object.prototype.hasOwnProperty.call(data, "photo"))
          throw new Error("invalid_photo");
        entry.expires = Date.now() + TTL;
        return data.photo as Photo | null;
      })
      .catch((error) => {
        if (photos.get(hex) === entry) photos.delete(hex);
        throw error;
      }),
  };
  photos.set(hex, entry);
  return entry.promise;
}
