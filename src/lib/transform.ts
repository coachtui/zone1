import { ControlPoint } from "./types";
import { convertToLatLng } from "./projection";

// --- 3x3 matrix inverse (returns null if singular) ---

export function invertMatrix3x3(M: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, k]] = M;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [(e * k - f * h) * inv, (c * h - b * k) * inv, (b * f - c * e) * inv],
    [(f * g - d * k) * inv, (a * k - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

// --- Affine transform result ---

export interface AffineTransform {
  // [lng]   [a  b  tx] [px]
  // [lat] = [c  d  ty] [py]
  //                    [1 ]
  a: number; b: number; tx: number;
  c: number; d: number; ty: number;
}

export interface ControlPointResult {
  cp: ControlPoint;
  lat: number;
  lng: number;
  residualM: number; // approximate residual in meters
}

export interface AffineResult {
  transform: AffineTransform;
  /** "similarity" when solved from exactly 2 points; "affine" for 3+ (least-squares). */
  method: "similarity" | "affine";
  points: ControlPointResult[];
  imgW: number;
  imgH: number;
  maxResidualM: number;
  rmsResidualM: number;
}

/**
 * Similarity transform (4-DOF: translation + uniform scale + rotation) from
 * exactly 2 control points.
 *
 * Image y-down convention: moving down the plan goes south (lower lat).
 *
 *   lng = tx + a·px + b·py
 *   lat = ty + b·px − a·py
 *
 * Represented as an AffineTransform with c=b, d=−a (no skew / non-uniform scale).
 */
function computeSimilarityFrom2Points(
  p1: ControlPointResult,
  p2: ControlPointResult
): AffineTransform | null {
  const dpx = p2.cp.imageX - p1.cp.imageX;
  const dpy = p2.cp.imageY - p1.cp.imageY;
  const denom = dpx * dpx + dpy * dpy;
  if (Math.abs(denom) < 1e-10) return null; // coincident points

  const dLng = p2.lng - p1.lng;
  const dLat = p2.lat - p1.lat;

  const a = (dLng * dpx - dLat * dpy) / denom;
  const b = (dLng * dpy + dLat * dpx) / denom;

  const tx = p1.lng - a * p1.cp.imageX - b * p1.cp.imageY;
  const ty = p1.lat - b * p1.cp.imageX + a * p1.cp.imageY;

  return { a, b, tx, c: b, d: -a, ty };
}

/**
 * Compute an affine transform (6-DOF) from image pixels to WGS84 lat/lng
 * using least-squares over n ≥ 3 control points.
 *
 * Image convention: (0,0) = top-left, y increases downward.
 * The affine handles north-up plans with arbitrary rotation/scale/skew.
 *
 * Returns null if:
 *   - fewer than 3 points have valid conversions
 *   - the normal-equation matrix is singular (collinear points)
 */
export function computeAffineFromControlPoints(
  controlPoints: ControlPoint[],
  crsValue: string
): AffineResult | { error: string } {
  // Convert all points; collect valid ones
  const valid: ControlPointResult[] = [];

  for (const cp of controlPoints) {
    const n = parseFloat(cp.northing);
    const e = parseFloat(cp.easting);
    if (isNaN(n) || isNaN(e)) continue;
    try {
      const { lat, lng } = convertToLatLng(n, e, crsValue);
      valid.push({ cp, lat, lng, residualM: 0 });
    } catch {
      // skip invalid points
    }
  }

  if (valid.length < 2) {
    return {
      error: `Need at least 2 valid control points; only ${valid.length} have valid N/E coordinates.`,
    };
  }

  // ── 2-point path: similarity transform (exact) ───────────────────────────
  if (valid.length === 2) {
    const t = computeSimilarityFrom2Points(valid[0], valid[1]);
    if (!t) {
      return { error: "The two control points are at the same image position." };
    }
    const imgW = valid[0].cp.imgW;
    const imgH = valid[0].cp.imgH;
    return { transform: t, method: "similarity", points: valid, imgW, imgH, maxResidualM: 0, rmsResidualM: 0 };
  }

  // ── 3+ point path: affine least-squares ──────────────────────────────────

  // Least-squares: build A^T A and A^T b for both lng and lat.
  // For each point: [px, py, 1] * [a, b, tx]^T = lng
  //                 [px, py, 1] * [c, d, ty]^T = lat
  let sxx = 0, sxy = 0, sx = 0;
  let syy = 0, sy = 0;
  let n = 0;
  let sxLng = 0, syLng = 0, sLng = 0;
  let sxLat = 0, syLat = 0, sLat = 0;

  for (const { cp, lat, lng } of valid) {
    const px = cp.imageX, py = cp.imageY;
    sxx += px * px; sxy += px * py; sx += px;
    syy += py * py; sy += py; n++;
    sxLng += px * lng; syLng += py * lng; sLng += lng;
    sxLat += px * lat; syLat += py * lat; sLat += lat;
  }

  // M = A^T A
  const M = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx,  sy,  n ],
  ];
  const Minv = invertMatrix3x3(M);
  if (!Minv) {
    return {
      error:
        "Control points are collinear or coincident — cannot solve transform. " +
        "Spread points across the overlay.",
    };
  }

  const solve3 = (b: [number, number, number]) => [
    Minv[0][0] * b[0] + Minv[0][1] * b[1] + Minv[0][2] * b[2],
    Minv[1][0] * b[0] + Minv[1][1] * b[1] + Minv[1][2] * b[2],
    Minv[2][0] * b[0] + Minv[2][1] * b[1] + Minv[2][2] * b[2],
  ];

  const [a, b2, tx] = solve3([sxLng, syLng, sLng]);
  const [c, d,  ty] = solve3([sxLat, syLat, sLat]);

  const transform: AffineTransform = { a, b: b2, tx, c, d, ty };

  // Compute residuals
  let sumSq = 0;
  let maxResidualM = 0;
  const DEG_TO_M = 111_320; // ~1° lat ≈ 111 km

  for (const vp of valid) {
    const predLng = a * vp.cp.imageX + b2 * vp.cp.imageY + tx;
    const predLat = c * vp.cp.imageX + d  * vp.cp.imageY + ty;
    const dLat = (predLat - vp.lat) * DEG_TO_M;
    const dLng = (predLng - vp.lng) * DEG_TO_M * Math.cos((vp.lat * Math.PI) / 180);
    const resM = Math.sqrt(dLat * dLat + dLng * dLng);
    vp.residualM = resM;
    sumSq += resM * resM;
    if (resM > maxResidualM) maxResidualM = resM;
  }

  const rmsResidualM = Math.sqrt(sumSq / valid.length);

  // Get image dimensions from first valid point (all same image)
  const imgW = valid[0].cp.imgW;
  const imgH = valid[0].cp.imgH;

  return { transform, method: "affine", points: valid, imgW, imgH, maxResidualM, rmsResidualM };
}

/**
 * Apply an affine transform to a single image pixel.
 */
export function applyAffine(
  t: AffineTransform,
  px: number,
  py: number
): { lng: number; lat: number } {
  return {
    lng: t.a * px + t.b * py + t.tx,
    lat: t.c * px + t.d * py + t.ty,
  };
}

/**
 * Derive the 4 overlay corner lat/lngs from an affine transform + image size.
 * Returns null if any corner is outside the valid WGS84 range.
 */
export function cornersFromAffine(
  t: AffineTransform,
  imgW: number,
  imgH: number
): {
  topLeft: { lat: number; lng: number };
  topRight: { lat: number; lng: number };
  bottomRight: { lat: number; lng: number };
  bottomLeft: { lat: number; lng: number };
} | null {
  const corners = [
    applyAffine(t, 0,    0   ),  // top-left
    applyAffine(t, imgW, 0   ),  // top-right
    applyAffine(t, imgW, imgH),  // bottom-right
    applyAffine(t, 0,    imgH),  // bottom-left
  ];

  for (const { lat, lng } of corners) {
    if (
      !isFinite(lat) || !isFinite(lng) ||
      lat < -90 || lat > 90 ||
      lng < -180 || lng > 180
    ) {
      return null;
    }
  }

  return {
    topLeft:     corners[0],
    topRight:    corners[1],
    bottomRight: corners[2],
    bottomLeft:  corners[3],
  };
}
