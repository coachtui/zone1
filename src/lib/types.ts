export type InteractionMode =
  | "idle"
  | "creating"
  | "positioning"
  | "capturing-ref-point";

export type MarkupTool = 'none' | 'rectangle' | 'circle' | 'line' | 'polyline' | 'measure';

export interface MarkupStyle {
  color: string;
  lineWidth: number;
  fillOpacity: number;
}

export interface MarkupShape {
  id: string;
  type: 'rectangle' | 'circle' | 'line' | 'polyline' | 'measure';
  /**
   * rectangle: [corner1, corner2] (diagonal, screen-space axis-aligned)
   * circle: [center, edge]
   * line: [p1, p2]
   * polyline/measure: ordered 2+ points
   */
  points: { lat: number; lng: number }[];
  style: MarkupStyle;
}

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
