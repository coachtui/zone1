"use client";

import { useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import Map from "@/components/Map";
import { Project, Overlay, InteractionMode, ControlPoint } from "@/lib/types";
import { DEFAULT_CRS, CRSValue } from "@/lib/projection";

export default function Home() {
  const [mode, setMode] = useState<InteractionMode>("idle");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);

  // Control point georeferencing state (reset when overlay is deselected)
  const [controlPoints, setControlPoints] = useState<ControlPoint[]>([]);
  const [selectedCRS, setSelectedCRS] = useState<CRSValue>(DEFAULT_CRS);

  // ── Map interaction ──────────────────────────────────────────────────────

  const handleMapClick = useCallback(
    (lng: number, lat: number) => {
      if (mode === "creating") {
        setPendingLocation({ lng, lat });
      }
    },
    [mode]
  );

  // ── Project lifecycle ────────────────────────────────────────────────────

  const handleProjectCreated = useCallback((project: Project) => {
    setSelectedProject(project);
    setMode("idle");
    setPendingLocation(null);
  }, []);

  const handleStartCreate = useCallback(() => {
    setMode("creating");
    setSelectedProject(null);
    setPendingLocation(null);
    setOverlays([]);
    setSelectedOverlayId(null);
    setControlPoints([]);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setMode("idle");
    setPendingLocation(null);
  }, []);

  const handleSelectProject = useCallback((project: Project | null) => {
    setSelectedProject(project);
    setOverlays([]);
    setSelectedOverlayId(null);
    setMode("idle");
    setControlPoints([]);
  }, []);

  // ── Overlay lifecycle ────────────────────────────────────────────────────

  const handleOverlayAdded = useCallback((overlay: Overlay) => {
    setOverlays((prev) => [overlay, ...prev]);
  }, []);

  const handleOverlayUpdated = useCallback((overlay: Overlay) => {
    setOverlays((prev) => prev.map((o) => (o.id === overlay.id ? overlay : o)));
  }, []);

  const handleOverlaysLoaded = useCallback((loaded: Overlay[]) => {
    setOverlays(loaded);
  }, []);

  const handleSelectOverlay = useCallback((overlayId: string | null) => {
    setSelectedOverlayId(overlayId);
    setMode(overlayId ? "positioning" : "idle");
    if (!overlayId) {
      setControlPoints([]);
    }
  }, []);

  const handleOverlayDeleted = useCallback((overlayId: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== overlayId));
    setSelectedOverlayId(null);
    setMode("idle");
    setControlPoints([]);
  }, []);

  const handleProjectDeleted = useCallback(() => {
    setSelectedProject(null);
    setOverlays([]);
    setSelectedOverlayId(null);
    setMode("idle");
    setControlPoints([]);
  }, []);

  // ── Control point georeferencing ─────────────────────────────────────────

  /** Sidebar requests capture mode — map will capture the next click. */
  const handleStartCapture = useCallback(() => {
    setMode("capturing-ref-point");
  }, []);

  /** Map captured image-space click → append a new control point. */
  const handleControlPointCaptured = useCallback(
    (px: number, py: number, imgW: number, imgH: number) => {
      const newPoint: ControlPoint = {
        id: crypto.randomUUID(),
        imageX: Math.round(px),
        imageY: Math.round(py),
        imgW,
        imgH,
        northing: "",
        easting: "",
        elevation: "",
      };
      setControlPoints((prev) => [...prev, newPoint]);
      setMode("positioning"); // return to normal interaction
    },
    []
  );

  const handleControlPointUpdate = useCallback(
    (id: string, fields: Partial<ControlPoint>) => {
      setControlPoints((prev) =>
        prev.map((cp) => (cp.id === id ? { ...cp, ...fields } : cp))
      );
    },
    []
  );

  const handleControlPointDelete = useCallback((id: string) => {
    setControlPoints((prev) => prev.filter((cp) => cp.id !== id));
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar
        selectedProject={selectedProject}
        onSelectProject={handleSelectProject}
        mode={mode}
        onStartCreate={handleStartCreate}
        onCancelCreate={handleCancelCreate}
        pendingLocation={pendingLocation}
        onProjectCreated={handleProjectCreated}
        overlays={overlays}
        onOverlayAdded={handleOverlayAdded}
        onOverlayUpdated={handleOverlayUpdated}
        onOverlaysLoaded={handleOverlaysLoaded}
        selectedOverlayId={selectedOverlayId}
        onSelectOverlay={handleSelectOverlay}
        onOverlayDeleted={handleOverlayDeleted}
        onProjectDeleted={handleProjectDeleted}
        controlPoints={controlPoints}
        selectedCRS={selectedCRS}
        onSelectedCRSChange={setSelectedCRS}
        onStartCapture={handleStartCapture}
        onControlPointUpdate={handleControlPointUpdate}
        onControlPointDelete={handleControlPointDelete}
      />
      <div className="flex-1 relative min-h-0">
        <Map
          selectedProject={selectedProject}
          mode={mode}
          pendingLocation={pendingLocation}
          onMapClick={handleMapClick}
          overlays={overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={handleSelectOverlay}
          onOverlayUpdated={handleOverlayUpdated}
          onControlPointCaptured={handleControlPointCaptured}
        />
      </div>
    </div>
  );
}
