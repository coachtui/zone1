export type InteractionMode =
  | "idle"
  | "creating"
  | "positioning"
  | "capturing-ref-point";

/** A single control point used to georeference an overlay. */
export interface ControlPoint {
  id: string;
  /** Pixel position on the plan image (y increases downward). */
  imageX: number;
  imageY: number;
  /** Natural dimensions of the plan image (same for every point on the same overlay). */
  imgW: number;
  imgH: number;
  /** Raw input strings — kept as strings so the user can edit freely. */
  northing: string;
  easting: string;
  elevation: string; // optional, not used in transform
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  center_lng: number;
  center_lat: number;
  zoom: number;
  created_at: string;
  updated_at: string;
}

export interface Overlay {
  id: string;
  project_id: string;
  name: string;
  image_url: string;
  opacity: number;
  top_left_lng: number;
  top_left_lat: number;
  top_right_lng: number;
  top_right_lat: number;
  bottom_right_lng: number;
  bottom_right_lat: number;
  bottom_left_lng: number;
  bottom_left_lat: number;
  created_at: string;
  updated_at: string;
}
