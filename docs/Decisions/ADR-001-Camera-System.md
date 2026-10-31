# ADR-001: Isometric 2.5D Camera Projection & Depth Sorting on Canvas 2D

## 1. Context
AgentCorp simulates a virtual office where AI workers walk, sit at desks, carry items, and interact with office decor.
The visual presentation required:
- Spatial depth cues (agents visually occluding or standing behind furniture).
- Smooth 60 FPS rendering in standard web browsers without dedicated GPU requirements.
- Delivering a clean, nostalgic pixel-art visual aesthetic for the virtual office.

## 2. Decision
- **Avoid Heavy 3D Engines (Three.js / WebGL):** Eliminates GPU driver inconsistencies and large asset bundle sizes.
- **Use HTML5 Canvas 2D with Isometric 2.5D Projection (`scene/view.ts`):**
  - World coordinates `(x, y, z)` map to screen coordinates `(screenX, screenY)` via isometric matrix projection (`ROOM_CENTER = { x: 0, z: 2 }`).
  - **Y-Sorting (Painter's Algorithm):** Sprites (desks, workers, pets, furniture) sort along depth axes prior to each frame render, providing correct occlusion boundaries.
  - Supports 4-quadrant room rotation (`azimuth`, `farWalls`), smooth pan, and scaling zoom based on `viewHeight`.

## 3. Consequences
- **Positive:**
  - Lightweight bundle size, instant startup, minimal browser memory overhead (<50MB).
  - High cross-browser reliability without WebGL context loss risks.
- **Trade-offs:**
  - Limited to fixed 90-degree orthogonal isometric rotations rather than arbitrary continuous 360-degree rotation.
  - Directional rotation requires directional sprite sheets or programmatic sprite flipping (`mirrored`).
