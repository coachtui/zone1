"use client";

import { useRef, useEffect } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Project, Overlay, InteractionMode } from "@/lib/types";
import { updateOverlay } from "@/actions/overlays";

// Compute the 3x3 homography matrix that maps image pixels (w x h) to screen points.
// Returns null if the quad is degenerate.
function computeHomographyMatrix(
  w: number,
  h: number,
  x0: number, y0: number, // top-left screen
  x1: number, y1: number, // top-right screen
  x2: number, y2: number, // bottom-right screen
  x3: number, y3: number  // bottom-left screen
): number[][] | null {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-10) return null;

  const a13 = (dx3 * dy2 - dx2 * dy3) / det;
  const a23 = (dx1 * dy3 - dx3 * dy1) / det;

  // H maps unit square → destination quad; scale columns by image dims
  return [
    [(x1 - x0 + a13 * x1) / w, (x3 - x0 + a23 * x3) / h, x0],
    [(y1 - y0 + a13 * y1) / w, (y3 - y0 + a23 * y3) / h, y0],
    [a13 / w,                   a23 / h,                   1 ],
  ];
}

// Invert a 3x3 matrix. Returns null if singular.
function invertMatrix3x3(M: number[][]): number[][] | null {
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

// Compute CSS matrix3d that maps image (w x h) to 4 arbitrary screen points
function computePerspectiveTransform(
  w: number,
  h: number,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
): string {
  const H = computeHomographyMatrix(w, h, x0, y0, x1, y1, x2, y2, x3, y3);
  if (!H) return "none";

  const [a, b, c] = H[0];
  const [d, e, f] = H[1];
  const [g, i, j] = H[2];

  // CSS matrix3d is column-major
  return `matrix3d(${a},${d},0,${g},${b},${e},0,${i},0,0,1,0,${c},${f},0,${j})`;
}

function translateOverlay(overlay: Overlay, dLng: number, dLat: number): Overlay {
  return {
    ...overlay,
    top_left_lng: overlay.top_left_lng + dLng,
    top_left_lat: overlay.top_left_lat + dLat,
    top_right_lng: overlay.top_right_lng + dLng,
    top_right_lat: overlay.top_right_lat + dLat,
    bottom_right_lng: overlay.bottom_right_lng + dLng,
    bottom_right_lat: overlay.bottom_right_lat + dLat,
    bottom_left_lng: overlay.bottom_left_lng + dLng,
    bottom_left_lat: overlay.bottom_left_lat + dLat,
  };
}

interface MapProps {
  selectedProject: Project | null;
  mode: InteractionMode;
  pendingLocation: { lng: number; lat: number } | null;
  onMapClick: (lng: number, lat: number) => void;
  overlays: Overlay[];
  selectedOverlayId: string | null;
  onSelectOverlay: (overlayId: string | null) => void;
  onOverlayUpdated: (overlay: Overlay) => void;
  /** Called when user clicks map in capturing-ref-point mode. World lat/lng is NOT
   *  passed — the caller derives world coords from the entered N/E. Only the image
   *  pixel and image dimensions are forwarded. */
  onControlPointCaptured: (px: number, py: number, imgW: number, imgH: number) => void;
}

interface ViewEntry {
  update: (overlay: Overlay, isSelected: boolean) => void;
  remove: () => void;
  getImagePixel: (lat: number, lng: number) => { px: number; py: number; imgW: number; imgH: number } | null;
}

export default function Map({
  selectedProject,
  mode,
  pendingLocation,
  onMapClick,
  overlays,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayUpdated,
  onControlPointCaptured,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const viewsRef = useRef<globalThis.Map<string, ViewEntry>>(new globalThis.Map());
  const dragStateRef = useRef<{ overlayId: string; lastLng: number; lastLat: number } | null>(null);
  const applyOverlaysRef = useRef<((overlays: Overlay[], selectedId: string | null) => void) | null>(null);
  const pendingMarkerRef = useRef<google.maps.Marker | null>(null);
  const MarkerRef = useRef<typeof google.maps.Marker | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SymbolPathRef = useRef<any>(null);

  // Keep latest props accessible in event handlers without re-registering
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const selectedOverlayIdRef = useRef(selectedOverlayId);
  selectedOverlayIdRef.current = selectedOverlayId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onSelectOverlayRef = useRef(onSelectOverlay);
  onSelectOverlayRef.current = onSelectOverlay;
  const onOverlayUpdatedRef = useRef(onOverlayUpdated);
  onOverlayUpdatedRef.current = onOverlayUpdated;
  const onControlPointCapturedRef = useRef(onControlPointCaptured);
  onControlPointCapturedRef.current = onControlPointCaptured;

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    setOptions({
      key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
      v: "weekly",
    });

    Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
    ]).then(() => {
        if (destroyed || !containerRef.current) return;

        MarkerRef.current = google.maps.Marker;
        SymbolPathRef.current = google.maps.SymbolPath;

        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 39.8, lng: -98.5 },
          zoom: 4,
          mapTypeId: "satellite",
          fullscreenControl: false,
          mapTypeControl: false,
          streetViewControl: false,
        });

        mapRef.current = map;

        // --- ImageOverlay class (defined here so it has access to google) ---
        class ImageOverlay extends google.maps.OverlayView {
          private _overlay: Overlay;
          private _selected: boolean;
          private _onClick: () => void;
          private _container: HTMLDivElement | null = null;
          private _img: HTMLImageElement | null = null;
          private _border: HTMLDivElement | null = null;
          private _H: number[][] | null = null;
          private _imgW = 0;
          private _imgH = 0;

          constructor(overlay: Overlay, selected: boolean, onClick: () => void) {
            super();
            this._overlay = overlay;
            this._selected = selected;
            this._onClick = onClick;
          }

          onAdd() {
            this._container = document.createElement("div");
            this._container.style.cssText = "position:absolute;cursor:pointer;";

            this._img = document.createElement("img");
            this._img.src = this._overlay.image_url;
            this._img.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none;";
            this._img.onload = () => this.draw();

            this._border = document.createElement("div");
            this._border.style.cssText =
              "position:absolute;top:0;left:0;border:3px dashed #f97316;pointer-events:none;display:none;transform-origin:0 0;";

            this._container.appendChild(this._img);
            this._container.appendChild(this._border);
            this._container.addEventListener("click", (e) => {
              e.stopPropagation();
              this._onClick();
            });

            this.getPanes()!.overlayLayer.appendChild(this._container);
          }

          draw() {
            if (!this._container || !this._img || !this._img.naturalWidth) return;

            const proj = this.getProjection();
            const o = this._overlay;

            const pts = [
              proj.fromLatLngToDivPixel({ lat: o.top_left_lat, lng: o.top_left_lng })!,
              proj.fromLatLngToDivPixel({ lat: o.top_right_lat, lng: o.top_right_lng })!,
              proj.fromLatLngToDivPixel({ lat: o.bottom_right_lat, lng: o.bottom_right_lng })!,
              proj.fromLatLngToDivPixel({ lat: o.bottom_left_lat, lng: o.bottom_left_lng })!,
            ];

            const w = this._img.naturalWidth;
            const h = this._img.naturalHeight;
            this._H = computeHomographyMatrix(
              w, h,
              pts[0].x, pts[0].y,
              pts[1].x, pts[1].y,
              pts[2].x, pts[2].y,
              pts[3].x, pts[3].y
            );
            this._imgW = w;
            this._imgH = h;
            const tx = this._H
              ? `matrix3d(${this._H[0][0]},${this._H[1][0]},0,${this._H[2][0]},${this._H[0][1]},${this._H[1][1]},0,${this._H[2][1]},0,0,1,0,${this._H[0][2]},${this._H[1][2]},0,${this._H[2][2]})`
              : "none";

            this._img.style.width = `${w}px`;
            this._img.style.height = `${h}px`;
            this._img.style.transform = tx;
            this._img.style.opacity = String(o.opacity);

            this._border!.style.width = `${w}px`;
            this._border!.style.height = `${h}px`;
            this._border!.style.transform = tx;
            this._border!.style.display = this._selected ? "block" : "none";
          }

          onRemove() {
            this._container?.parentNode?.removeChild(this._container);
            this._container = null;
            this._img = null;
            this._border = null;
          }

          update(overlay: Overlay, selected: boolean) {
            this._overlay = overlay;
            this._selected = selected;
            this.draw();
          }

          getImagePixel(lat: number, lng: number): { px: number; py: number; imgW: number; imgH: number } | null {
            if (!this._H || !this._imgW) return null;
            const Hinv = invertMatrix3x3(this._H);
            if (!Hinv) return null;
            const sp = this.getProjection().fromLatLngToDivPixel({ lat, lng });
            if (!sp) return null;
            const sx = sp.x, sy = sp.y;
            const w = Hinv[2][0] * sx + Hinv[2][1] * sy + Hinv[2][2];
            return {
              px: (Hinv[0][0] * sx + Hinv[0][1] * sy + Hinv[0][2]) / w,
              py: (Hinv[1][0] * sx + Hinv[1][1] * sy + Hinv[1][2]) / w,
              imgW: this._imgW,
              imgH: this._imgH,
            };
          }
        }

        // --- Overlay management function ---
        applyOverlaysRef.current = (overlays: Overlay[], selectedId: string | null) => {
          const currentIds = new Set(overlays.map((o) => o.id));

          // Remove views no longer needed
          for (const [id, entry] of viewsRef.current) {
            if (!currentIds.has(id)) {
              entry.remove();
              viewsRef.current.delete(id);
            }
          }

          // Add or update
          for (const overlay of overlays) {
            const isSelected = overlay.id === selectedId;
            const existing = viewsRef.current.get(overlay.id);
            if (existing) {
              existing.update(overlay, isSelected);
            } else {
              const view = new ImageOverlay(
                overlay,
                isSelected,
                () => onSelectOverlayRef.current(overlay.id)
              );
              view.setMap(map);
              viewsRef.current.set(overlay.id, {
                update: (o, s) => view.update(o, s),
                remove: () => { view.setMap(null); },
                getImagePixel: (lat, lng) => view.getImagePixel(lat, lng),
              });
            }
          }
        };

        // --- Map click: create mode, capture control point, or deselect ---
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (modeRef.current === "creating") {
            onMapClickRef.current(e.latLng!.lng(), e.latLng!.lat());
            return;
          }
          if (modeRef.current === "capturing-ref-point") {
            if (e.latLng && selectedOverlayIdRef.current) {
              const lat = e.latLng.lat();
              const lng = e.latLng.lng();
              const result = viewsRef.current
                .get(selectedOverlayIdRef.current)
                ?.getImagePixel(lat, lng);
              if (result) {
                // World coordinate comes from the user's N/E input, not from this click.
                // We only pass image-space coords.
                onControlPointCapturedRef.current(
                  result.px, result.py, result.imgW, result.imgH
                );
              }
            }
            return;
          }
          if (modeRef.current === "positioning") {
            onSelectOverlayRef.current(null);
          }
        });

        // --- Drag: move selected overlay ---
        map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
          if (modeRef.current !== "positioning" || !selectedOverlayIdRef.current || !e.latLng) return;
          map.setOptions({ draggable: false, gestureHandling: "none" });
          dragStateRef.current = {
            overlayId: selectedOverlayIdRef.current,
            lastLng: e.latLng.lng(),
            lastLat: e.latLng.lat(),
          };
        });

        map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
          const drag = dragStateRef.current;
          if (!drag || !e.latLng) return;

          const dLng = e.latLng.lng() - drag.lastLng;
          const dLat = e.latLng.lat() - drag.lastLat;
          dragStateRef.current = { ...drag, lastLng: e.latLng.lng(), lastLat: e.latLng.lat() };

          const overlay = overlaysRef.current.find((o) => o.id === drag.overlayId);
          if (overlay) {
            onOverlayUpdatedRef.current(translateOverlay(overlay, dLng, dLat));
          }
        });

        const handleMouseUp = () => {
          const drag = dragStateRef.current;
          if (!drag) return;
          dragStateRef.current = null;
          map.setOptions({ draggable: true, gestureHandling: "greedy" });

          const overlay = overlaysRef.current.find((o) => o.id === drag.overlayId);
          if (overlay) {
            updateOverlay(overlay.id, {
              top_left_lng: overlay.top_left_lng,
              top_left_lat: overlay.top_left_lat,
              top_right_lng: overlay.top_right_lng,
              top_right_lat: overlay.top_right_lat,
              bottom_right_lng: overlay.bottom_right_lng,
              bottom_right_lat: overlay.bottom_right_lat,
              bottom_left_lng: overlay.bottom_left_lng,
              bottom_left_lat: overlay.bottom_left_lat,
            }).catch(console.error);
          }
        };

        map.addListener("mouseup", handleMouseUp);

        // --- Geolocate button ---
        // Strategy: run watchPosition for GATHER_MS with high accuracy and
        // maximumAge=0 to force fresh GPS readings.  Collect all fixes, then
        // pick the one with the best (lowest) reported accuracy radius.
        // The button is disabled during acquisition to prevent overlapping requests.
        const GATHER_MS = 3500;

        const geoBtn = document.createElement("button");
        geoBtn.title = "Show my location";
        geoBtn.style.cssText =
          "background:#fff;border:none;border-radius:2px;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;padding:8px;margin:10px;font-size:18px;line-height:1;";
        geoBtn.textContent = "◎";
        geoBtn.addEventListener("click", () => {
          if (geoBtn.disabled) return;
          geoBtn.disabled = true;
          geoBtn.textContent = "…";

          const fixes: GeolocationPosition[] = [];
          const watchId = navigator.geolocation.watchPosition(
            (pos) => { fixes.push(pos); },
            (err) => { console.warn("Geolocation error:", err.message); },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
          );

          setTimeout(() => {
            navigator.geolocation.clearWatch(watchId);
            geoBtn.disabled = false;
            geoBtn.textContent = "◎";

            if (fixes.length === 0) return;

            // Pick the fix with the smallest accuracy radius (best GPS fix).
            const best = fixes.reduce((a, b) =>
              a.coords.accuracy <= b.coords.accuracy ? a : b
            );
            const latLng = { lat: best.coords.latitude, lng: best.coords.longitude };

            if (markerRef.current) {
              markerRef.current.setPosition(latLng);
            } else {
              markerRef.current = new google.maps.Marker({
                position: latLng,
                map,
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: "#4285F4",
                  fillOpacity: 1,
                  strokeColor: "#fff",
                  strokeWeight: 2,
                },
                title: "Your location",
              });
            }
            map.panTo(latLng);
          }, GATHER_MS);
        });
        map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(geoBtn);
      });

    return () => {
      destroyed = true;
      applyOverlaysRef.current = null;
      for (const entry of viewsRef.current.values()) entry.remove();
      viewsRef.current.clear();
      mapRef.current = null;
    };
  }, []);

  // Sync overlays whenever they or the selection change
  useEffect(() => {
    applyOverlaysRef.current?.(overlays, selectedOverlayId);
  }, [overlays, selectedOverlayId]);

  // Pending location marker
  useEffect(() => {
    const map = mapRef.current;
    const Marker = MarkerRef.current;
    const SymbolPath = SymbolPathRef.current;
    if (!map || !Marker || !SymbolPath) return;

    if (pendingLocation) {
      const pos = { lat: pendingLocation.lat, lng: pendingLocation.lng };
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.setPosition(pos);
      } else {
        pendingMarkerRef.current = new Marker({
          position: pos,
          map,
          icon: {
            path: SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#f97316",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        });
      }
    } else {
      pendingMarkerRef.current?.setMap(null);
      pendingMarkerRef.current = null;
    }
  }, [pendingLocation]);

  // Update cursor based on mode
  useEffect(() => {
    if (!containerRef.current) return;
    if (mode === "creating" || mode === "capturing-ref-point") {
      containerRef.current.style.cursor = "crosshair";
    } else if (mode === "positioning" && selectedOverlayId) {
      containerRef.current.style.cursor = "grab";
    } else {
      containerRef.current.style.cursor = "";
    }
  }, [mode, selectedOverlayId]);

  // Fly to selected project
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedProject) return;
    map.panTo({ lat: selectedProject.center_lat, lng: selectedProject.center_lng });
    map.setZoom(selectedProject.zoom);
  }, [selectedProject]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      {mode === "creating" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-gray-700 z-10">
          Click the map to set the project center
        </div>
      )}
      {mode === "positioning" && selectedOverlayId && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-orange-500/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white z-10">
          Drag overlay to reposition · Use sidebar to adjust scale, rotation &amp; opacity
        </div>
      )}
      {mode === "capturing-ref-point" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white z-10">
          Click on the plan where the control point is located
        </div>
      )}
    </>
  );
}
