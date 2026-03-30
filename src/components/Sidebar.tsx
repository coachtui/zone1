"use client";

import { useEffect, useState, useRef } from "react";
import { Project, Overlay, InteractionMode, ControlPoint } from "@/lib/types";
import { getProjects, createProject, deleteProject } from "@/actions/projects";
import {
  getOverlays,
  createOverlay,
  updateOverlay,
  deleteOverlay,
  uploadOverlayImage,
} from "@/actions/overlays";
import { CRS_OPTIONS, CRSValue, convertToLatLng } from "@/lib/projection";
import {
  computeAffineFromControlPoints,
  cornersFromAffine,
  AffineResult,
} from "@/lib/transform";

// ── Local transform helpers ──────────────────────────────────────────────────

function rotateOverlay(overlay: Overlay, degrees: number): Overlay {
  const cx =
    (overlay.top_left_lng + overlay.top_right_lng + overlay.bottom_right_lng + overlay.bottom_left_lng) / 4;
  const cy =
    (overlay.top_left_lat + overlay.top_right_lat + overlay.bottom_right_lat + overlay.bottom_left_lat) / 4;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (lng: number, lat: number) => ({
    lng: cx + (lng - cx) * cos - (lat - cy) * sin,
    lat: cy + (lng - cx) * sin + (lat - cy) * cos,
  });
  const tl = rotate(overlay.top_left_lng, overlay.top_left_lat);
  const tr = rotate(overlay.top_right_lng, overlay.top_right_lat);
  const br = rotate(overlay.bottom_right_lng, overlay.bottom_right_lat);
  const bl = rotate(overlay.bottom_left_lng, overlay.bottom_left_lat);
  return {
    ...overlay,
    top_left_lng: tl.lng, top_left_lat: tl.lat,
    top_right_lng: tr.lng, top_right_lat: tr.lat,
    bottom_right_lng: br.lng, bottom_right_lat: br.lat,
    bottom_left_lng: bl.lng, bottom_left_lat: bl.lat,
  };
}

function scaleOverlay(overlay: Overlay, factor: number): Overlay {
  const cx =
    (overlay.top_left_lng + overlay.top_right_lng + overlay.bottom_right_lng + overlay.bottom_left_lng) / 4;
  const cy =
    (overlay.top_left_lat + overlay.top_right_lat + overlay.bottom_right_lat + overlay.bottom_left_lat) / 4;
  const s = (v: number, c: number) => c + (v - c) * factor;
  return {
    ...overlay,
    top_left_lng: s(overlay.top_left_lng, cx), top_left_lat: s(overlay.top_left_lat, cy),
    top_right_lng: s(overlay.top_right_lng, cx), top_right_lat: s(overlay.top_right_lat, cy),
    bottom_right_lng: s(overlay.bottom_right_lng, cx), bottom_right_lat: s(overlay.bottom_right_lat, cy),
    bottom_left_lng: s(overlay.bottom_left_lng, cx), bottom_left_lat: s(overlay.bottom_left_lat, cy),
  };
}

// ── Sidebar props ────────────────────────────────────────────────────────────

interface SidebarProps {
  selectedProject: Project | null;
  onSelectProject: (project: Project | null) => void;
  mode: InteractionMode;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  pendingLocation: { lng: number; lat: number } | null;
  onProjectCreated: (project: Project) => void;
  overlays: Overlay[];
  onOverlayAdded: (overlay: Overlay) => void;
  onOverlayUpdated: (overlay: Overlay) => void;
  onOverlaysLoaded: (overlays: Overlay[]) => void;
  selectedOverlayId: string | null;
  onSelectOverlay: (overlayId: string | null) => void;
  onOverlayDeleted: (overlayId: string) => void;
  onProjectDeleted: (projectId: string) => void;
  // Georeferencing
  controlPoints: ControlPoint[];
  selectedCRS: CRSValue;
  onSelectedCRSChange: (crs: CRSValue) => void;
  onStartCapture: () => void;
  onControlPointUpdate: (id: string, fields: Partial<ControlPoint>) => void;
  onControlPointDelete: (id: string) => void;
  onClose: () => void;
}

// ── Try-convert helper (called on every render, no stored lat/lng in state) ──

function tryConvert(
  cp: ControlPoint,
  crs: string
): { lat: number; lng: number } | { error: string } {
  const n = parseFloat(cp.northing);
  const e = parseFloat(cp.easting);
  if (isNaN(n) || isNaN(e) || cp.northing === "" || cp.easting === "") {
    return { error: "" }; // empty — not an error yet
  }
  try {
    return convertToLatLng(n, e, crs);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Conversion failed" };
  }
}

// ── Control point row ────────────────────────────────────────────────────────

function ControlPointRow({
  cp,
  index,
  crs,
  onUpdate,
  onDelete,
}: {
  cp: ControlPoint;
  index: number;
  crs: string;
  onUpdate: (id: string, fields: Partial<ControlPoint>) => void;
  onDelete: (id: string) => void;
}) {
  const result = tryConvert(cp, crs);
  const hasResult = "lat" in result;
  const hasError = "error" in result && result.error !== "";

  return (
    <div className="mb-3 p-2 bg-white rounded border border-gray-200 text-xs">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-medium text-gray-700">
          {hasResult ? "✓" : hasError ? "✕" : "○"} Point {index + 1}
          <span className="ml-1 text-gray-400 font-normal">
            ({cp.imageX}, {cp.imageY})
          </span>
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(cp.id); }}
          className="text-red-400 hover:text-red-600 px-1"
          title="Remove point"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1 mb-1">
        <input
          type="text"
          inputMode="decimal"
          placeholder="Northing"
          value={cp.northing}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onUpdate(cp.id, { northing: e.target.value }); }}
          className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0"
        />
        <input
          type="text"
          inputMode="decimal"
          placeholder="Easting"
          value={cp.easting}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onUpdate(cp.id, { easting: e.target.value }); }}
          className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-0"
        />
      </div>

      <input
        type="text"
        inputMode="decimal"
        placeholder="Elevation (optional)"
        value={cp.elevation}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); onUpdate(cp.id, { elevation: e.target.value }); }}
        className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 mb-1"
      />

      {hasResult && (
        <div className="text-green-700 bg-green-50 rounded px-1.5 py-0.5">
          {result.lat.toFixed(6)}°, {result.lng.toFixed(6)}°
        </div>
      )}
      {hasError && (
        <div className="text-red-600 bg-red-50 rounded px-1.5 py-0.5 break-words">
          {result.error}
        </div>
      )}
    </div>
  );
}

// ── Debug panel ──────────────────────────────────────────────────────────────

function DebugPanel({
  controlPoints,
  crs,
  affineResult,
  applyError,
}: {
  controlPoints: ControlPoint[];
  crs: string;
  affineResult: AffineResult | null;
  applyError: string | null;
}) {
  return (
    <div className="text-xs bg-gray-900 text-green-300 rounded p-2 font-mono space-y-1 max-h-48 overflow-y-auto">
      <div className="text-gray-400">CRS: {crs}</div>
      <div className="text-gray-400">Points: {controlPoints.length}</div>
      {controlPoints.map((cp, i) => {
        const r = tryConvert(cp, crs);
        return (
          <div key={cp.id}>
            <span className="text-gray-500">P{i + 1} img=({cp.imageX},{cp.imageY}) </span>
            {"lat" in r
              ? <span className="text-green-400">→ {r.lat.toFixed(5)}, {r.lng.toFixed(5)}</span>
              : <span className="text-red-400">→ {r.error || "empty"}</span>
            }
          </div>
        );
      })}
      {affineResult && (
        <>
          <div className="text-yellow-300 border-t border-gray-700 pt-1">
            Transform: a={affineResult.transform.a.toExponential(3)} b={affineResult.transform.b.toExponential(3)}
          </div>
          <div className="text-yellow-300">
            c={affineResult.transform.c.toExponential(3)} d={affineResult.transform.d.toExponential(3)}
          </div>
          <div className="text-yellow-300">
            RMS residual: {affineResult.rmsResidualM.toFixed(2)} m | max: {affineResult.maxResidualM.toFixed(2)} m
          </div>
        </>
      )}
      {applyError && (
        <div className="text-red-400 border-t border-gray-700 pt-1">
          ERROR: {applyError}
        </div>
      )}
    </div>
  );
}

// ── Sidebar component ────────────────────────────────────────────────────────

export default function Sidebar({
  selectedProject,
  onSelectProject,
  mode,
  onStartCreate,
  onCancelCreate,
  pendingLocation,
  onProjectCreated,
  overlays,
  onOverlayAdded,
  onOverlayUpdated,
  onOverlaysLoaded,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayDeleted,
  onProjectDeleted,
  controlPoints,
  selectedCRS,
  onSelectedCRSChange,
  onStartCapture,
  onControlPointUpdate,
  onControlPointDelete,
  onClose,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [lastAffineResult, setLastAffineResult] = useState<AffineResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null;

  // ── Derived: counts and preview (computed every render, cheap) ─────────────
  const validPointCount = controlPoints.filter((cp) => "lat" in tryConvert(cp, selectedCRS)).length;

  const affinePreview = (() => {
    if (validPointCount < 2) return null;
    const result = computeAffineFromControlPoints(controlPoints, selectedCRS);
    return "error" in result ? null : result;
  })();

  // ── Data loading ─────────────────────────────────────────────────────────

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    getOverlays(selectedProject.id).then(onOverlaysLoaded).catch(console.error);
  }, [selectedProject, onOverlaysLoaded]);

  // ── Project handlers ─────────────────────────────────────────────────────

  const handleSaveProject = async () => {
    if (!name.trim() || !pendingLocation) return;
    setSaving(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        center_lng: pendingLocation.lng,
        center_lat: pendingLocation.lat,
        zoom: 17,
      });
      setProjects((prev) => [project, ...prev]);
      setName("");
      setDescription("");
      onProjectCreated(project);
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    if (!confirm(`Delete "${selectedProject.name}" and all its overlays?`)) return;
    setDeleting(selectedProject.id);
    try {
      await deleteProject(selectedProject.id);
      setProjects((prev) => prev.filter((p) => p.id !== selectedProject.id));
      onProjectDeleted(selectedProject.id);
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      setDeleting(null);
    }
  };

  // ── Overlay handlers ─────────────────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;
    setUploading(true);
    try {
      // Read natural image dimensions before upload to preserve aspect ratio
      const { width: imgW, height: imgH } = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Cannot read image dimensions")); };
          img.src = url;
        }
      );
      const formData = new FormData();
      formData.append("file", file);
      const imageUrl = await uploadOverlayImage(formData);
      const offsetLng = 0.002;
      const cLng = selectedProject.center_lng;
      const cLat = selectedProject.center_lat;
      const cosLat = Math.cos((cLat * Math.PI) / 180);
      const offsetLat = offsetLng * cosLat * (imgH / imgW);
      const overlay = await createOverlay({
        project_id: selectedProject.id,
        name: file.name,
        image_url: imageUrl,
        opacity: 0.7,
        top_left_lng: cLng - offsetLng,
        top_left_lat: cLat + offsetLat,
        top_right_lng: cLng + offsetLng,
        top_right_lat: cLat + offsetLat,
        bottom_right_lng: cLng + offsetLng,
        bottom_right_lat: cLat - offsetLat,
        bottom_left_lng: cLng - offsetLng,
        bottom_left_lat: cLat - offsetLat,
      });
      onOverlayAdded(overlay);
    } catch (err) {
      console.error("Failed to upload overlay:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOpacityChange = async (overlay: Overlay, opacity: number) => {
    onOverlayUpdated({ ...overlay, opacity });
    try {
      await updateOverlay(overlay.id, { opacity });
    } catch (err) {
      console.error("Failed to update opacity:", err);
      onOverlayUpdated(overlay);
    }
  };

  const handleScale = async (overlay: Overlay, factor: number) => {
    const scaled = scaleOverlay(overlay, factor);
    onOverlayUpdated(scaled);
    try {
      await updateOverlay(overlay.id, {
        top_left_lng: scaled.top_left_lng, top_left_lat: scaled.top_left_lat,
        top_right_lng: scaled.top_right_lng, top_right_lat: scaled.top_right_lat,
        bottom_right_lng: scaled.bottom_right_lng, bottom_right_lat: scaled.bottom_right_lat,
        bottom_left_lng: scaled.bottom_left_lng, bottom_left_lat: scaled.bottom_left_lat,
      });
    } catch (err) {
      console.error("Failed to scale overlay:", err);
      onOverlayUpdated(overlay);
    }
  };

  const handleRotate = async (overlay: Overlay, degrees: number) => {
    const rotated = rotateOverlay(overlay, degrees);
    onOverlayUpdated(rotated);
    try {
      await updateOverlay(overlay.id, {
        top_left_lng: rotated.top_left_lng, top_left_lat: rotated.top_left_lat,
        top_right_lng: rotated.top_right_lng, top_right_lat: rotated.top_right_lat,
        bottom_right_lng: rotated.bottom_right_lng, bottom_right_lat: rotated.bottom_right_lat,
        bottom_left_lng: rotated.bottom_left_lng, bottom_left_lat: rotated.bottom_left_lat,
      });
    } catch (err) {
      console.error("Failed to rotate overlay:", err);
      onOverlayUpdated(overlay);
    }
  };

  const handleDeleteOverlay = async (overlayId: string) => {
    setDeleting(overlayId);
    try {
      await deleteOverlay(overlayId);
      onOverlayDeleted(overlayId);
    } catch (err) {
      console.error("Failed to delete overlay:", err);
    } finally {
      setDeleting(null);
    }
  };

  // ── Georeferencing: Apply affine transform ───────────────────────────────

  const handleApplyTransform = async () => {
    if (!selectedOverlay) return;
    setApplyError(null);
    setApplySuccess(false);

    console.log("[Georeference] Starting apply with", controlPoints.length, "points, CRS:", selectedCRS);
    console.log("[Georeference] Points:", controlPoints.map((cp) => ({
      image: [cp.imageX, cp.imageY],
      northing: cp.northing,
      easting: cp.easting,
    })));

    const result = computeAffineFromControlPoints(controlPoints, selectedCRS);

    if ("error" in result) {
      console.error("[Georeference] Affine solve failed:", result.error);
      setApplyError(result.error);
      return;
    }

    console.log("[Georeference] Transform solved:", result.transform);
    console.log("[Georeference] RMS residual:", result.rmsResidualM.toFixed(2), "m");
    setLastAffineResult(result);

    const corners = cornersFromAffine(result.transform, result.imgW, result.imgH);

    if (!corners) {
      const msg =
        "Computed corners are outside valid lat/lng range. " +
        "Check CRS selection and N/E values (likely a unit mismatch: feet vs meters).";
      console.error("[Georeference] Invalid corners:", msg);
      setApplyError(msg);
      return; // ← overlay is NOT modified; previous position preserved
    }

    console.log("[Georeference] Corners:", corners);

    const updated: Overlay = {
      ...selectedOverlay,
      top_left_lng:     corners.topLeft.lng,     top_left_lat:     corners.topLeft.lat,
      top_right_lng:    corners.topRight.lng,    top_right_lat:    corners.topRight.lat,
      bottom_right_lng: corners.bottomRight.lng, bottom_right_lat: corners.bottomRight.lat,
      bottom_left_lng:  corners.bottomLeft.lng,  bottom_left_lat:  corners.bottomLeft.lat,
    };

    // Optimistic update
    onOverlayUpdated(updated);

    try {
      await updateOverlay(selectedOverlay.id, {
        top_left_lng:     corners.topLeft.lng,     top_left_lat:     corners.topLeft.lat,
        top_right_lng:    corners.topRight.lng,    top_right_lat:    corners.topRight.lat,
        bottom_right_lng: corners.bottomRight.lng, bottom_right_lat: corners.bottomRight.lat,
        bottom_left_lng:  corners.bottomLeft.lng,  bottom_left_lat:  corners.bottomLeft.lat,
      });
      setApplySuccess(true);
      console.log("[Georeference] Saved to database.");
    } catch (err) {
      console.error("[Georeference] DB save failed:", err);
      setApplyError("Database save failed — overlay position shown but not persisted.");
      onOverlayUpdated(selectedOverlay); // rollback
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="w-80 h-full border-r border-gray-200 bg-gray-50 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Zone1</h1>
          <p className="text-xs text-gray-500 mt-0.5">Jobsite Map Overlays</p>
        </div>
        <button
          onClick={onClose}
          className="md:hidden ml-2 p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 active:bg-gray-300"
          aria-label="Close sidebar"
        >
          ✕
        </button>
      </div>

      {mode === "creating" ? (
        /* Create project form */
        <div className="p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-700">New Project</h2>
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            autoFocus
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
          />
          {pendingLocation ? (
            <div className="text-xs text-gray-500 bg-white p-2 rounded border border-gray-200">
              Location: {pendingLocation.lat.toFixed(6)}, {pendingLocation.lng.toFixed(6)}
            </div>
          ) : (
            <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded border border-orange-200">
              Click the map to set the project center
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSaveProject}
              disabled={!name.trim() || !pendingLocation || saving}
              className="flex-1 px-3 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Create Project"}
            </button>
            <button
              onClick={onCancelCreate}
              className="px-3 py-2 border border-gray-300 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : selectedProject ? (
        /* Project detail + overlays */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Back + project info */}
          <div className="p-4 border-b border-gray-200">
            <button
              onClick={() => onSelectProject(null)}
              className="text-xs text-orange-600 hover:text-orange-700 mb-2 flex items-center gap-1"
            >
              &larr; All Projects
            </button>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-900">{selectedProject.name}</div>
                {selectedProject.description && (
                  <div className="text-xs text-gray-500 mt-1">{selectedProject.description}</div>
                )}
              </div>
              <button
                onClick={handleDeleteProject}
                disabled={deleting === selectedProject.id}
                className="text-xs text-red-500 hover:text-red-700 shrink-0"
                title="Delete project"
              >
                {deleting === selectedProject.id ? "..." : "Delete"}
              </button>
            </div>
          </div>

          {/* Upload overlay */}
          <div className="p-4 border-b border-gray-200">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full px-3 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {uploading ? "Uploading..." : "+ Upload Overlay Image"}
            </button>
            <p className="text-xs text-gray-400 mt-1.5">PNG, JPG, or WebP. Will be placed at project center.</p>
          </div>

          {/* Overlay list */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {overlays.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No overlays yet</p>
            ) : (
              <div className="flex flex-col gap-3 pt-3">
                {overlays.map((overlay) => {
                  const isSelected = overlay.id === selectedOverlayId;
                  return (
                    <div
                      key={overlay.id}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-orange-50 border-orange-300"
                          : "bg-white border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => onSelectOverlay(isSelected ? null : overlay.id)}
                    >
                      {/* Name + delete */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-900 truncate">{overlay.name}</div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteOverlay(overlay.id); }}
                          disabled={deleting === overlay.id}
                          className="text-xs text-red-400 hover:text-red-600 shrink-0"
                          title="Delete overlay"
                        >
                          {deleting === overlay.id ? "..." : "x"}
                        </button>
                      </div>

                      {/* Opacity */}
                      <div className="mt-2">
                        <label className="text-xs text-gray-500 flex items-center justify-between">
                          <span>Opacity</span>
                          <span>{Math.round(overlay.opacity * 100)}%</span>
                        </label>
                        <input
                          type="range" min="0" max="1" step="0.05"
                          value={overlay.opacity}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleOpacityChange(overlay, parseFloat(e.target.value))}
                          className="w-full mt-1 accent-orange-500"
                        />
                      </div>

                      {/* Controls when selected */}
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t border-orange-200">

                          {/* Scale */}
                          <label className="text-xs text-gray-500 block mb-2">Scale</label>
                          <div className="flex gap-2 mb-3">
                            {[["- 5%", 0.95], ["- 1%", 0.99], ["+ 1%", 1.01], ["+ 5%", 1.05]].map(([label, factor]) => (
                              <button
                                key={label as string}
                                onClick={(e) => { e.stopPropagation(); handleScale(overlay, factor as number); }}
                                className="flex-1 px-2 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                              >
                                {label as string}
                              </button>
                            ))}
                          </div>

                          {/* Rotate */}
                          <label className="text-xs text-gray-500 block mb-2">Rotate</label>
                          <div className="flex gap-2 mb-3">
                            {[["↺ 5°", -5], ["↺ 1°", -1], ["↻ 1°", 1], ["↻ 5°", 5]].map(([label, deg]) => (
                              <button
                                key={label as string}
                                onClick={(e) => { e.stopPropagation(); handleRotate(overlay, deg as number); }}
                                className="flex-1 px-2 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                              >
                                {label as string}
                              </button>
                            ))}
                          </div>

                          <p className="text-xs text-orange-600 mb-3">Drag on map to reposition</p>

                          {/* ── Reference Points ─────────────────────────── */}
                          <div className="border-t border-orange-200 pt-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-medium text-gray-700">
                                Georeference
                              </span>
                              <span className="text-xs text-gray-400">
                                {validPointCount}/{controlPoints.length} valid
                              </span>
                            </div>

                            {/* CRS selector */}
                            <label className="text-xs text-gray-500 block mb-1">
                              Coordinate System
                            </label>
                            <select
                              value={selectedCRS}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                onSelectedCRSChange(e.target.value as CRSValue);
                                setApplyError(null);
                                setApplySuccess(false);
                              }}
                              className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2"
                            >
                              {CRS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>

                            {/* Control point list */}
                            {controlPoints.map((cp, i) => (
                              <ControlPointRow
                                key={cp.id}
                                cp={cp}
                                index={i}
                                crs={selectedCRS}
                                onUpdate={onControlPointUpdate}
                                onDelete={onControlPointDelete}
                              />
                            ))}

                            {/* Add point button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setApplyError(null);
                                setApplySuccess(false);
                                onStartCapture();
                              }}
                              disabled={mode === "capturing-ref-point"}
                              className="w-full px-2 py-1.5 text-xs font-medium bg-white border border-blue-400 text-blue-600 rounded hover:bg-blue-50 disabled:opacity-50 transition-colors mb-2"
                            >
                              {mode === "capturing-ref-point"
                                ? "Click on the plan…"
                                : "+ Add Control Point"}
                            </button>

                            {/* Transform status */}
                            {controlPoints.length > 0 && validPointCount < 2 && (
                              <p className="text-xs text-gray-400 mb-2">
                                {2 - validPointCount} more valid point{2 - validPointCount !== 1 ? "s" : ""} needed
                              </p>
                            )}
                            {affinePreview && (
                              <p className="text-xs text-green-700 mb-2">
                                ✓ {validPointCount} pts · {affinePreview.method}
                                {affinePreview.rmsResidualM > 0
                                  ? ` · RMS ${affinePreview.rmsResidualM.toFixed(1)} m`
                                  : " · exact fit"}
                              </p>
                            )}

                            {/* Apply */}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleApplyTransform(); }}
                              disabled={validPointCount < 2}
                              className="w-full px-2 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-2"
                            >
                              Apply Transform
                            </button>

                            {/* Feedback */}
                            {applyError && (
                              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-2 break-words">
                                {applyError}
                              </div>
                            )}
                            {applySuccess && !applyError && (
                              <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2 mb-2">
                                ✓ Overlay aligned and saved
                              </div>
                            )}

                            {/* Debug toggle */}
                            <button
                              onClick={(e) => { e.stopPropagation(); setShowDebug((v) => !v); }}
                              className="text-xs text-gray-400 hover:text-gray-600 mb-1"
                            >
                              {showDebug ? "▼" : "▶"} Debug
                            </button>
                            {showDebug && (
                              <DebugPanel
                                controlPoints={controlPoints}
                                crs={selectedCRS}
                                affineResult={lastAffineResult}
                                applyError={applyError}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Project list */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 pb-2">
            <button
              onClick={onStartCreate}
              className="w-full px-3 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors"
            >
              + New Project
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {loading ? (
              <p className="text-sm text-gray-400 py-4 text-center">Loading...</p>
            ) : projects.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No projects yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject(project)}
                    className="text-left p-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 transition-colors"
                  >
                    <div className="text-sm font-medium text-gray-900">{project.name}</div>
                    {project.description && (
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{project.description}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
