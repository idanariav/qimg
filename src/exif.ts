/**
 * Opportunistic EXIF/IPTC/XMP extraction via exifr.
 * Returns a flattened text blob suitable for FTS indexing plus a few
 * structured fields. Failures are silent — many vault images have no EXIF.
 */

import exifr from "exifr";

export interface ExifData {
  taken_at?: number; // unix ms
  camera?: string;
  lens?: string;
  gps_lat?: number;
  gps_lon?: number;
  exif_text: string; // concatenated keywords/description for FTS
}

export async function extractExif(imagePath: string): Promise<ExifData> {
  const empty: ExifData = { exif_text: "" };
  try {
    const data = await exifr.parse(imagePath, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      mergeOutput: true,
    });
    if (!data) return empty;

    const camera = [data.Make, data.Model].filter(Boolean).join(" ").trim() || undefined;
    const lens = (data.LensModel as string | undefined) || (data.Lens as string | undefined);
    const taken =
      (data.DateTimeOriginal as Date | undefined) ||
      (data.CreateDate as Date | undefined);

    const textBits: string[] = [];
    for (const k of ["ImageDescription", "Caption", "Description", "Title", "Headline"]) {
      const v = data[k];
      if (typeof v === "string" && v.trim()) textBits.push(v.trim());
    }
    const keywords = data.Keywords ?? data.subject;
    if (Array.isArray(keywords)) textBits.push(keywords.join(" "));
    else if (typeof keywords === "string") textBits.push(keywords);

    return {
      taken_at: taken instanceof Date ? taken.getTime() : undefined,
      camera,
      lens,
      gps_lat: typeof data.latitude === "number" ? data.latitude : undefined,
      gps_lon: typeof data.longitude === "number" ? data.longitude : undefined,
      exif_text: textBits.join(" ").trim(),
    };
  } catch {
    return empty;
  }
}
