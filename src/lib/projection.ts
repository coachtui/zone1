import proj4 from "proj4";

// Coordinate reference systems supported for N/E input.
// Add more here as needed; value must be the key used in convertToLatLng.
export const CRS_OPTIONS = [
  {
    value: "EPSG:3759",
    label: "Hawaii Zone 3 – Oahu (US survey feet) ← most common",
    proj4str:
      "+proj=tmerc +lat_0=21.1666666666667 +lon_0=-158 +k=0.99999 +x_0=500000.00001016001 +y_0=0 +ellps=GRS80 +units=us-ft +no_defs",
  },
  {
    value: "EPSG:3750",
    label: "Hawaii Zone 3 – Oahu (meters)",
    proj4str:
      "+proj=tmerc +lat_0=21.1666666666667 +lon_0=-158 +k=0.99999 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs",
  },
  {
    value: "EPSG:32604",
    label: "UTM Zone 4N – Hawaii (WGS84, meters)",
    proj4str: "+proj=utm +zone=4 +datum=WGS84 +units=m +no_defs",
  },
  {
    value: "EPSG:26904",
    label: "UTM Zone 4N – Hawaii (NAD83, meters)",
    proj4str:
      "+proj=utm +zone=4 +ellps=GRS80 +datum=NAD83 +units=m +no_defs",
  },
] as const;

export type CRSValue = (typeof CRS_OPTIONS)[number]["value"];

export const DEFAULT_CRS: CRSValue = "EPSG:3759";

/**
 * Convert a projected Northing/Easting pair to WGS84 lat/lng.
 * Throws a descriptive Error if:
 *   - the CRS key is unknown
 *   - the conversion produces non-finite numbers
 *   - the output is outside the valid lat/lng range
 *
 * Input order matches Trimble field data: northing first, then easting.
 */
export function convertToLatLng(
  northing: number,
  easting: number,
  crsValue: string
): { lat: number; lng: number } {
  const crs = CRS_OPTIONS.find((c) => c.value === crsValue);
  if (!crs) {
    throw new Error(`Unknown CRS "${crsValue}". Select a supported option.`);
  }

  // proj4 convention: [x, y] = [easting, northing]
  const [lng, lat] = proj4(crs.proj4str, "WGS84", [easting, northing]);

  if (!isFinite(lat) || !isFinite(lng)) {
    throw new Error(
      `Conversion produced non-finite result (lat=${lat}, lng=${lng}). ` +
        `Check that Northing/Easting values match the selected CRS.`
    );
  }
  if (lat < -90 || lat > 90) {
    throw new Error(
      `Converted latitude ${lat.toFixed(4)}° is out of range [-90°, 90°]. ` +
        `Verify CRS and that N/E are not swapped.`
    );
  }
  if (lng < -180 || lng > 180) {
    throw new Error(
      `Converted longitude ${lng.toFixed(4)}° is out of range [-180°, 180°]. ` +
        `Verify CRS and that N/E are not swapped.`
    );
  }

  return { lat, lng };
}
