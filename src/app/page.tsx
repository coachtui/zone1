"use client";

import { useState, useCallback, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Map from "@/components/Map";
import MarkupToolbox, { PLAN_SCALES } from "@/components/MarkupToolbox";
import { Project, Overlay, InteractionMode, ControlPoint, MarkupTool, MarkupStyle, MarkupShape } from "@/lib/types";
import { DEFAULT_CRS, CRSValue } from "@/lib/projection";

export default function Home() {
  const [mode, setMode] = useState<InteractionMode>("idle");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (mode === "capturing-ref-point") setSidebarOpen(false);
  }, [mode]);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);

  const [controlPoints, setControlPoints] = useState<ControlPoint[]>([]);
  const [selectedCRS, setSelectedCRS] = useState<CRSValue>(DEFAULT_CRS);

  // ── Markup state ─────────────────────────────────────────────────────────

  const [activeTool, setActiveTool] = useState<MarkupTool>('none');
  const [markupShapes, setMarkupShapes] = useState<MarkupShape[]>([]);
  const [markupStyle, setMarkupStyle] = useState<MarkupStyle>({
    color: '#ef4444',
    lineWidth: 2,
    fillOpacity: 0,
  });
  const [measureUnit, setMeasureUnit] = useState<'ft' | 'm'>('ft');
  const [planScale, setPlanScale] = useState(PLAN_SCALES[1].label); // 1"=20' default

  const handleToolChange = useCallback((tool: MarkupTool) => {
    setActiveTool(tool);
  }, []);

  const handleStyleChange = useCallback((partial: Partial<MarkupStyle>) => {
    setMarkupStyle((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleShapeAdded = useCallback((shape: MarkupShape) => {
    setMarkupShapes((prev) => [...prev, shape]);
  }, []);

  const handleClearMarkup = useCallback(() => {
    setMarkupShapes([]);
  }, []);

  // ── Map interaction ──────────────────────────────────────────────────────

  const handleMapClick = useCallback(
    (lng: number, lat: number) => {
      if (mode === "creating") setPendingLocation({ lng, lat });
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
    if (!overlayId) setControlPoints([]);
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

  const handleStartCapture = useCallback(() => {
    setMode("capturing-ref-point");
  }, []);

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
      setMode("positioning");
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
    <div className="flex h-full relative overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-10"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={[
          "fixed md:relative z-20 h-full shrink-0",
          "transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
        ].join(" ")}
      >
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
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Map area */}
      <div className="flex-1 relative min-h-0">
        {!sidebarOpen && (
          <button
            className="md:hidden absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-2.5 text-gray-700 text-lg leading-none active:bg-gray-100"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            ☰
          </button>
        )}

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
          activeTool={activeTool}
          markupShapes={markupShapes}
          markupStyle={markupStyle}
          measureUnit={measureUnit}
          onShapeAdded={handleShapeAdded}
        />

        <MarkupToolbox
          activeTool={activeTool}
          onToolChange={handleToolChange}
          style={markupStyle}
          onStyleChange={handleStyleChange}
          measureUnit={measureUnit}
          onMeasureUnitChange={setMeasureUnit}
          planScale={planScale}
          onPlanScaleChange={setPlanScale}
          onClearMarkup={handleClearMarkup}
        />
      </div>
    </div>
  );
}
