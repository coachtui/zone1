# Zone1 — Progress

## Current Phase: Phase 1 complete → Phase 2 starting

### Completed
- Project CRUD (create, list, select, delete)
- Overlay upload + render on map
- Opacity control
- Overlay drag-to-move, scale (±1%/±5%), rotate (±1°/±5°)
- Selection highlight (orange dashed border)
- Switched map from Mapbox → Google Maps satellite (better accuracy in Hawaii)
- CSS perspective transform for 4-corner overlay rendering
- Geolocate button (tap to show location dot)
- Supabase schema + storage bucket

### Deferred (low priority)
- `.env.example`
- Error toasts (errors currently go to console)

### Next: Phase 2 — Reference Point Georeferencing
- Allow user to enter 2 known reference points (Northing/Easting from civil drawings)
- Convert Northing/Easting to lat/lng (Hawaii State Plane coordinate system)
- Snap overlay to match those real-world control points
- See `plans/current-phase.md` for details
