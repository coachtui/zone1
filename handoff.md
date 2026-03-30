# Zone1 — Handoff

## Last session
2026-03-30 — Phase 1 complete, Phase 2 planned

## Current state
App is fully functional for manual overlay alignment:
- Google Maps satellite imagery (switched from Mapbox — better accuracy in Hawaii)
- Upload overlay image → appears on map at project center
- Drag to move, ±1%/±5% scale, ±1°/±5° rotation, opacity slider
- Delete overlay / delete project
- Geolocate button (tap to show GPS dot, not persistent)
- All state persists to Supabase

## Exact restart point — Phase 2
Build reference point georeferencing so users can snap overlays to real-world coordinates from civil drawings.

**Step 1:** Research and decide on coordinate conversion approach
- Install `proj4` npm package
- Define Hawaii State Plane zones (start with EPSG:3750 Oahu)
- Write `statePlaneToLatLng(northing, easting, epsg) → {lat, lng}`
- Test with known Hawaii coordinates

**Step 2:** Decide on reference point UX (open question — ask user)
- How do they identify WHERE on the image the reference point is?
- Option A: Click on map to pick real-world point, then click on image to pick image point
- Option B: Use image corners as fixed reference points (simpler, less flexible)
- Option C: Enter normalized image position (0-1 for x and y)

**Step 3:** Build the 2-point transform
- Given 2 pairs of (image position, real-world lat/lng), derive new overlay corners
- Math: similarity transform (translation + rotation + uniform scale)

## Key architecture decisions
- Map is Google Maps JS API v3 (weekly) loaded via `@googlemaps/js-api-loader` v2 functional API
- Overlay rendering: custom `google.maps.OverlayView` subclass with CSS perspective transform
- 4-corner coordinate model in Supabase supports rotation and skew
- All overlay manipulation (move, scale, rotate) updates all 4 corners and persists via server action

## Watch out for
- `Map` namespace collision: use `globalThis.Map` for the JS built-in, `google.maps.Map` for Google Maps
- Google Maps API loader v2 uses `setOptions()` + `importLibrary()`, not `new Loader().load()`
- `ssr: false` is NOT needed for Google Maps (it loads itself async) — do not add dynamic import
- Supabase storage bucket `overlay-images` must be set to public for image URLs to work
- Server action body size limit set to `10mb` in `next.config.ts` for image uploads
