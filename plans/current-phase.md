# Phase 2: Reference Point Georeferencing

## Objective
Let users snap an overlay to real-world coordinates using 2 known physical features (building corners, manholes, etc.) that appear on both the Google Maps satellite and their construction plan.

## Workflow
1. User selects an overlay and enters "Reference Point" mode
2. For each of 2 reference points:
   a. Enter Northing + Easting from the civil drawing → app converts to lat/lng target
   b. Click on the map at the matching physical feature (visible through semi-transparent overlay)
      → gives real-world click lat/lng
      → also gives image pixel position (computed by inverting current overlay transform)
3. Press "Apply" — app computes similarity transform (translation + rotation + scale) and updates the 4 overlay corners

## Tasks (in order)

### P0 — Coordinate conversion
- [ ] Install `proj4` npm package
- [ ] Define Hawaii State Plane projection (start with EPSG:3750 Oahu; others on request)
- [ ] Utility: `statePlaneToLatLng(northing, easting, epsg) → { lat, lng }`
- [ ] Test with known Hawaii coordinates

### P1 — Reference point UI in Sidebar
- [ ] "Set Reference Points" section appears when overlay is selected
- [ ] 2 rows: each has Northing input, Easting input, and a "Click on map" capture button
- [ ] When capture mode is active: next map click is captured as control point (lat/lng)
- [ ] Show captured lat/lng next to inputs so user can confirm
- [ ] "Apply" button (enabled when both points have N/E + map click)

### P2 — Map click capture
- [ ] New interaction mode: `"capturing-ref-point"` (which point: 1 or 2)
- [ ] On map click in this mode: record lat/lng AND compute image pixel coords by inverting overlay transform
- [ ] Return to `"positioning"` mode after capture

### P3 — Compute and apply transform
- [ ] Given 2 pairs of (image pixel, real-world lat/lng):
  - Compute translation, rotation, and uniform scale
  - This is a similarity transform: 4 unknowns (tx, ty, scale, angle), solved with 2 point pairs
- [ ] Derive new 4-corner lat/lng from the transform
- [ ] Call `updateOverlay` to persist

## Math notes
Similarity transform from image pixel (px, py) to world (lng, lat):
  lng = tx + scale * (px * cos θ - py * sin θ)
  lat = ty + scale * (px * sin θ + py * cos θ)

Given 2 point pairs, solve for tx, ty, scale, θ (4 equations, 4 unknowns — exact solution).

## Constraints
- Hawaii State Plane only to start (user is in Hawaii)
- Keep UI minimal — field users on phones
- Overlay must already be roughly placed before reference points are set
  (the inversion of the transform needs a reasonable starting position)

## Out of scope
- Multi-zone automatic detection
- lat/lng input (N/E only for now)
- More than 2 reference points
