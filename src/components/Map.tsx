"use client";

import { useRef, useEffect } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { Project, Overlay, InteractionMode, MarkupTool, MarkupStyle, MarkupShape } from "@/lib/types";
import { updateOverlay } from "@/actions/overlays";

// ── Overlay geometry helpers ──────────────────────────────────────────────────

function computeHomographyMatrix(
  w: number,
  h: number,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
): number[][] | null {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-10) return null;
  const a13 = (dx3 * dy2 - dx2 * dy3) / det;
  const a23 = (dx1 * dy3 - dx3 * dy1) / det;
  return [
    [(x1 - x0 + a13 * x1) / w, (x3 - x0 + a23 * x3) / h, x0],
    [(y1 - y0 + a13 * y1) / w, (y3 - y0 + a23 * y3) / h, y0],
    [a13 / w,                   a23 / h,                   1 ],
  ];
}

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

// ── Markup SVG helpers ────────────────────────────────────────────────────────

type DrawingState =
  | { type: 'rectangle'; start: { lat: number; lng: number }; current: { lat: number; lng: number } }
  | { type: 'circle';    start: { lat: number; lng: number }; current: { lat: number; lng: number } }
  | { type: 'line';      start: { lat: number; lng: number }; current: { lat: number; lng: number } }
  | { type: 'polyline';  points: { lat: number; lng: number }[] }
  | { type: 'measure';   points: { lat: number; lng: number }[] };

function haversineMeters(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (p2.lat - p1.lat) * rad;
  const dLng = (p2.lng - p1.lng) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1.lat * rad) * Math.cos(p2.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineDist(points: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

function formatDist(meters: number, unit: 'ft' | 'm'): string {
  if (unit === 'ft') {
    const ft = meters * 3.28084;
    return ft >= 10 ? `${Math.round(ft)} ft` : `${ft.toFixed(1)} ft`;
  }
  return meters >= 10 ? `${Math.round(meters)} m` : `${meters.toFixed(1)} m`;
}

function svgEl<T extends SVGElement>(tag: string): T {
  return document.createElementNS('http://www.w3.org/2000/svg', tag) as T;
}

function latLngToPx(
  proj: google.maps.MapCanvasProjection,
  p: { lat: number; lng: number }
): { x: number; y: number } | null {
  const px = proj.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
  return px ? { x: px.x, y: px.y } : null;
}

function paintShape(
  svg: SVGSVGElement,
  type: MarkupShape['type'],
  points: { lat: number; lng: number }[],
  style: MarkupStyle,
  proj: google.maps.MapCanvasProjection,
  measureUnit: 'ft' | 'm',
  alpha = 1
) {
  const { color, lineWidth, fillOpacity } = style;

  if ((type === 'line' || type === 'rectangle') && points.length >= 2) {
    const a = latLngToPx(proj, points[0]);
    const b = latLngToPx(proj, points[1]);
    if (!a || !b) return;

    if (type === 'line') {
      const el = svgEl<SVGLineElement>('line');
      el.setAttribute('x1', String(a.x)); el.setAttribute('y1', String(a.y));
      el.setAttribute('x2', String(b.x)); el.setAttribute('y2', String(b.y));
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(lineWidth));
      el.setAttribute('stroke-opacity', String(alpha));
      el.setAttribute('stroke-linecap', 'round');
      svg.appendChild(el);
    } else {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (w < 2 || h < 2) return;
      const el = svgEl<SVGRectElement>('rect');
      el.setAttribute('x', String(x)); el.setAttribute('y', String(y));
      el.setAttribute('width', String(w)); el.setAttribute('height', String(h));
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(lineWidth));
      el.setAttribute('stroke-opacity', String(alpha));
      el.setAttribute('fill', color);
      el.setAttribute('fill-opacity', String(fillOpacity * alpha));
      svg.appendChild(el);
    }

  } else if (type === 'circle' && points.length >= 2) {
    const c = latLngToPx(proj, points[0]);
    const e = latLngToPx(proj, points[1]);
    if (!c || !e) return;
    const r = Math.sqrt((e.x - c.x) ** 2 + (e.y - c.y) ** 2);
    if (r < 2) return;
    const el = svgEl<SVGCircleElement>('circle');
    el.setAttribute('cx', String(c.x)); el.setAttribute('cy', String(c.y));
    el.setAttribute('r', String(r));
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', String(lineWidth));
    el.setAttribute('stroke-opacity', String(alpha));
    el.setAttribute('fill', color);
    el.setAttribute('fill-opacity', String(fillOpacity * alpha));
    svg.appendChild(el);

  } else if ((type === 'polyline' || type === 'measure') && points.length >= 2) {
    const pixels = points.map(p => latLngToPx(proj, p)).filter(Boolean) as { x: number; y: number }[];
    if (pixels.length < 2) return;

    const el = svgEl<SVGPolylineElement>('polyline');
    el.setAttribute('points', pixels.map(p => `${p.x},${p.y}`).join(' '));
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', String(lineWidth));
    el.setAttribute('stroke-opacity', String(alpha));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(el);

    if (type === 'measure') {
      const label = formatDist(polylineDist(points), measureUnit);
      const mid = pixels[Math.floor((pixels.length - 1) / 2)];

      const txt = svgEl<SVGTextElement>('text');
      txt.setAttribute('x', String(mid.x + 5));
      txt.setAttribute('y', String(mid.y - 7));
      txt.setAttribute('fill', '#1e293b');
      txt.setAttribute('font-size', '13');
      txt.setAttribute('font-weight', '600');
      txt.setAttribute('font-family', 'system-ui,sans-serif');
      txt.setAttribute('stroke', 'white');
      txt.setAttribute('stroke-width', '3');
      txt.setAttribute('paint-order', 'stroke');
      txt.setAttribute('opacity', String(alpha));
      txt.textContent = label;
      svg.appendChild(txt);

      for (const p of pixels) {
        const dot = svgEl<SVGCircleElement>('circle');
        dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y));
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', color);
        dot.setAttribute('opacity', String(alpha));
        svg.appendChild(dot);
      }
    }
  }
}

// ── Component types ───────────────────────────────────────────────────────────

interface MapProps {
  selectedProject: Project | null;
  mode: InteractionMode;
  pendingLocation: { lng: number; lat: number } | null;
  onMapClick: (lng: number, lat: number) => void;
  overlays: Overlay[];
  selectedOverlayId: string | null;
  onSelectOverlay: (overlayId: string | null) => void;
  onOverlayUpdated: (overlay: Overlay) => void;
  onControlPointCaptured: (px: number, py: number, imgW: number, imgH: number) => void;
  // Markup
  activeTool: MarkupTool;
  markupShapes: MarkupShape[];
  markupStyle: MarkupStyle;
  measureUnit: 'ft' | 'm';
  onShapeAdded: (shape: MarkupShape) => void;
}

interface ViewEntry {
  update: (overlay: Overlay, isSelected: boolean) => void;
  remove: () => void;
  getImagePixel: (lat: number, lng: number) => { px: number; py: number; imgW: number; imgH: number } | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  activeTool,
  markupShapes,
  markupStyle,
  measureUnit,
  onShapeAdded,
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

  // Markup refs
  const markupContainerRef = useRef<HTMLDivElement | null>(null);
  const renderMarkupRef = useRef<(() => void) | null>(null);
  const drawingRef = useRef<DrawingState | null>(null);
  const drawPreviewRef = useRef<{ lat: number; lng: number } | null>(null);

  // Keep latest props accessible in callbacks without re-registering listeners
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
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const markupShapesRef = useRef(markupShapes);
  markupShapesRef.current = markupShapes;
  const markupStyleRef = useRef(markupStyle);
  markupStyleRef.current = markupStyle;
  const measureUnitRef = useRef(measureUnit);
  measureUnitRef.current = measureUnit;
  const onShapeAddedRef = useRef(onShapeAdded);
  onShapeAddedRef.current = onShapeAdded;

  // ── Initialize map once ──────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    setOptions({
      key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!,
      v: "weekly",
    });

    Promise.all([importLibrary("maps"), importLibrary("marker")]).then(() => {
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

      // ── ImageOverlay class ─────────────────────────────────────────────────

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

      // ── Overlay management ─────────────────────────────────────────────────

      applyOverlaysRef.current = (overlays: Overlay[], selectedId: string | null) => {
        const currentIds = new Set(overlays.map((o) => o.id));
        for (const [id, entry] of viewsRef.current) {
          if (!currentIds.has(id)) { entry.remove(); viewsRef.current.delete(id); }
        }
        for (const overlay of overlays) {
          const isSelected = overlay.id === selectedId;
          const existing = viewsRef.current.get(overlay.id);
          if (existing) {
            existing.update(overlay, isSelected);
          } else {
            const view = new ImageOverlay(overlay, isSelected, () => onSelectOverlayRef.current(overlay.id));
            view.setMap(map);
            viewsRef.current.set(overlay.id, {
              update: (o, s) => view.update(o, s),
              remove: () => { view.setMap(null); },
              getImagePixel: (lat, lng) => view.getImagePixel(lat, lng),
            });
          }
        }
      };

      // ── Map events ─────────────────────────────────────────────────────────

      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (activeToolRef.current !== 'none') return;
        if (modeRef.current === "creating") {
          onMapClickRef.current(e.latLng!.lng(), e.latLng!.lat());
          return;
        }
        if (modeRef.current === "capturing-ref-point") {
          if (e.latLng && selectedOverlayIdRef.current) {
            const lat = e.latLng.lat(), lng = e.latLng.lng();
            const result = viewsRef.current.get(selectedOverlayIdRef.current)?.getImagePixel(lat, lng);
            if (result) onControlPointCapturedRef.current(result.px, result.py, result.imgW, result.imgH);
          }
          return;
        }
        if (modeRef.current === "positioning") onSelectOverlayRef.current(null);
      });

      map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
        if (activeToolRef.current !== 'none') return;
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
        if (overlay) onOverlayUpdatedRef.current(translateOverlay(overlay, dLng, dLat));
      });

      const handleMouseUp = () => {
        const drag = dragStateRef.current;
        if (!drag) return;
        dragStateRef.current = null;
        map.setOptions({ draggable: true, gestureHandling: "greedy" });
        const overlay = overlaysRef.current.find((o) => o.id === drag.overlayId);
        if (overlay) {
          updateOverlay(overlay.id, {
            top_left_lng: overlay.top_left_lng, top_left_lat: overlay.top_left_lat,
            top_right_lng: overlay.top_right_lng, top_right_lat: overlay.top_right_lat,
            bottom_right_lng: overlay.bottom_right_lng, bottom_right_lat: overlay.bottom_right_lat,
            bottom_left_lng: overlay.bottom_left_lng, bottom_left_lat: overlay.bottom_left_lat,
          }).catch(console.error);
        }
      };
      map.addListener("mouseup", handleMouseUp);

      // ── Geolocate button ────────────────────────────────────────────────────

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
          const best = fixes.reduce((a, b) => a.coords.accuracy <= b.coords.accuracy ? a : b);
          const latLng = { lat: best.coords.latitude, lng: best.coords.longitude };
          if (markerRef.current) {
            markerRef.current.setPosition(latLng);
          } else {
            markerRef.current = new google.maps.Marker({
              position: latLng, map,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8, fillColor: "#4285F4", fillOpacity: 1,
                strokeColor: "#fff", strokeWeight: 2,
              },
              title: "Your location",
            });
          }
          map.panTo(latLng);
        }, GATHER_MS);
      });
      map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(geoBtn);

      // ── Markup canvas ───────────────────────────────────────────────────────

      // Minimal OverlayView whose only job is to expose MapCanvasProjection
      class ProjectionHelper extends google.maps.OverlayView {
        onAdd() {}
        draw() { runRender?.(); }
        onRemove() {}
      }
      const projHelper = new ProjectionHelper();
      projHelper.setMap(map);

      // SVG container appended directly to the map div (above all panes, z-550)
      const markupDiv = document.createElement('div');
      markupDiv.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:550;';
      const markupSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      markupSvg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
      markupDiv.appendChild(markupSvg);
      map.getDiv().appendChild(markupDiv);
      markupContainerRef.current = markupDiv;

      // "Finish" button shown during polyline/measure drawing (mobile-friendly)
      const finishBtn = document.createElement('button');
      finishBtn.textContent = '✓ Finish';
      finishBtn.style.cssText =
        'display:none;position:absolute;top:60px;left:50%;transform:translateX(-50%);' +
        'background:#22c55e;color:white;border:none;border-radius:6px;padding:6px 16px;' +
        'font-size:13px;font-weight:600;cursor:pointer;z-index:600;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      map.getDiv().appendChild(finishBtn);

      let runRender: (() => void) | null = null;

      const renderMarkup = () => {
        const proj = projHelper.getProjection();
        if (!proj) return;
        while (markupSvg.firstChild) markupSvg.removeChild(markupSvg.firstChild);

        // Saved shapes
        for (const shape of markupShapesRef.current) {
          paintShape(markupSvg, shape.type, shape.points, shape.style, proj, measureUnitRef.current);
        }

        // In-progress drawing preview
        const ds = drawingRef.current;
        const preview = drawPreviewRef.current;
        if (ds) {
          if (ds.type === 'rectangle' || ds.type === 'circle' || ds.type === 'line') {
            paintShape(markupSvg, ds.type, [ds.start, ds.current], markupStyleRef.current, proj, measureUnitRef.current, 0.55);
          } else if (ds.type === 'polyline' || ds.type === 'measure') {
            // polyline / measure: preview segment from last committed point to cursor
            const pts = preview ? [...ds.points, preview] : ds.points;
            if (pts.length >= 2) {
              paintShape(markupSvg, ds.type, pts, markupStyleRef.current, proj, measureUnitRef.current, 0.55);
            }
            // Committed point dots
            for (const p of ds.points) {
              const px = latLngToPx(proj, p);
              if (!px) continue;
              const dot = svgEl<SVGCircleElement>('circle');
              dot.setAttribute('cx', String(px.x)); dot.setAttribute('cy', String(px.y));
              dot.setAttribute('r', '4');
              dot.setAttribute('fill', markupStyleRef.current.color);
              dot.setAttribute('opacity', '0.85');
              markupSvg.appendChild(dot);
            }
          }
        }
      };

      runRender = renderMarkup;
      renderMarkupRef.current = renderMarkup;

      const finalizePolyline = () => {
        const ds = drawingRef.current;
        if (!ds || (ds.type !== 'polyline' && ds.type !== 'measure')) return;
        if (ds.points.length >= 2) {
          onShapeAddedRef.current({
            id: crypto.randomUUID(),
            type: ds.type,
            points: ds.points,
            style: { ...markupStyleRef.current },
          });
        }
        drawingRef.current = null;
        drawPreviewRef.current = null;
        finishBtn.style.display = 'none';
        renderMarkup();
      };

      finishBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        finalizePolyline();
      });

      const getLatLng = (e: PointerEvent | MouseEvent): { lat: number; lng: number } | null => {
        const proj = projHelper.getProjection();
        if (!proj) return null;
        const rect = map.getDiv().getBoundingClientRect();
        const ll = proj.fromContainerPixelToLatLng(
          new google.maps.Point(e.clientX - rect.left, e.clientY - rect.top)
        );
        return ll ? { lat: ll.lat(), lng: ll.lng() } : null;
      };

      // Pointer events for drag-to-draw tools (rect, circle, line)
      markupDiv.addEventListener('pointerdown', (e: PointerEvent) => {
        const tool = activeToolRef.current;
        if (tool === 'none' || tool === 'polyline' || tool === 'measure') return;
        e.stopPropagation();
        e.preventDefault();
        const ll = getLatLng(e);
        if (!ll) return;
        markupDiv.setPointerCapture(e.pointerId);
        drawingRef.current = { type: tool, start: ll, current: ll };
        renderMarkup();
      });

      markupDiv.addEventListener('pointermove', (e: PointerEvent) => {
        if (activeToolRef.current === 'none') return;
        const ll = getLatLng(e);
        if (!ll) return;
        const ds = drawingRef.current;
        if (ds && (ds.type === 'rectangle' || ds.type === 'circle' || ds.type === 'line')) {
          drawingRef.current = { ...ds, current: ll };
        } else if (ds && (ds.type === 'polyline' || ds.type === 'measure')) {
          drawPreviewRef.current = ll;
        } else if (!ds) {
          drawPreviewRef.current = ll;
        }
        renderMarkup();
      });

      markupDiv.addEventListener('pointerup', (e: PointerEvent) => {
        const tool = activeToolRef.current;
        if (tool === 'none' || tool === 'polyline' || tool === 'measure') return;
        const ds = drawingRef.current;
        if (!ds) return;
        if (ds.type === 'polyline' || ds.type === 'measure') return;
        e.stopPropagation();
        const ll = getLatLng(e);
        if (!ll) return;
        if (Math.abs(ds.start.lat - ll.lat) > 1e-8 || Math.abs(ds.start.lng - ll.lng) > 1e-8) {
          onShapeAddedRef.current({
            id: crypto.randomUUID(),
            type: ds.type,
            points: [ds.start, ll],
            style: { ...markupStyleRef.current },
          });
        }
        drawingRef.current = null;
        renderMarkup();
      });

      // Click events for multi-point tools (polyline, measure)
      markupDiv.addEventListener('click', (e: MouseEvent) => {
        const tool = activeToolRef.current;
        if (tool !== 'polyline' && tool !== 'measure') return;
        if (e.detail === 2) return; // ignore second click of a dblclick
        e.stopPropagation();
        const ll = getLatLng(e);
        if (!ll) return;
        const ds = drawingRef.current;
        if (!ds || ds.type !== tool) {
          drawingRef.current = { type: tool, points: [ll] };
        } else {
          drawingRef.current = { ...ds, points: [...ds.points, ll] };
        }
        const updated = drawingRef.current as Extract<DrawingState, { points: unknown[] }>;
        finishBtn.style.display = updated.points.length >= 2 ? 'block' : 'none';
        renderMarkup();
      });

      markupDiv.addEventListener('dblclick', (e: MouseEvent) => {
        const tool = activeToolRef.current;
        if (tool !== 'polyline' && tool !== 'measure') return;
        e.stopPropagation();
        finalizePolyline();
      });

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && drawingRef.current) {
          drawingRef.current = null;
          drawPreviewRef.current = null;
          finishBtn.style.display = 'none';
          renderMarkup();
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      map.addListener('bounds_changed', renderMarkup);

      // ── Cleanup ─────────────────────────────────────────────────────────────

      return () => {
        destroyed = true;
        document.removeEventListener('keydown', handleKeyDown);
        markupDiv.remove();
        finishBtn.remove();
        projHelper.setMap(null);
        markupContainerRef.current = null;
        renderMarkupRef.current = null;
        runRender = null;
        drawingRef.current = null;
        applyOverlaysRef.current = null;
        for (const entry of viewsRef.current.values()) entry.remove();
        viewsRef.current.clear();
        mapRef.current = null;
      };
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync overlays ──────────────────────────────────────────────────────────

  useEffect(() => {
    applyOverlaysRef.current?.(overlays, selectedOverlayId);
  }, [overlays, selectedOverlayId]);

  // ── Pending location marker ────────────────────────────────────────────────

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
          position: pos, map,
          icon: {
            path: SymbolPath.CIRCLE,
            scale: 10, fillColor: "#f97316", fillOpacity: 1,
            strokeColor: "#fff", strokeWeight: 2,
          },
        });
      }
    } else {
      pendingMarkerRef.current?.setMap(null);
      pendingMarkerRef.current = null;
    }
  }, [pendingLocation]);

  // ── Cursor based on interaction mode ──────────────────────────────────────

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

  // ── Fly to selected project ────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedProject) return;
    map.panTo({ lat: selectedProject.center_lat, lng: selectedProject.center_lng });
    map.setZoom(selectedProject.zoom);
  }, [selectedProject]);

  // ── Activate / deactivate markup tool ─────────────────────────────────────

  useEffect(() => {
    const container = markupContainerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;
    if (activeTool !== 'none') {
      container.style.pointerEvents = 'all';
      container.style.cursor = 'crosshair';
      map.setOptions({ gestureHandling: 'none', draggable: false });
      // Cancel any in-progress drawing from a previous tool
      drawingRef.current = null;
      drawPreviewRef.current = null;
      renderMarkupRef.current?.();
    } else {
      container.style.pointerEvents = 'none';
      container.style.cursor = '';
      map.setOptions({ gestureHandling: 'greedy', draggable: true });
      drawingRef.current = null;
      drawPreviewRef.current = null;
      renderMarkupRef.current?.();
    }
  }, [activeTool]);

  // ── Re-render markup when shapes / style / unit change ────────────────────

  useEffect(() => {
    renderMarkupRef.current?.();
  }, [markupShapes, markupStyle, measureUnit]);

  // ── Render ─────────────────────────────────────────────────────────────────

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
