# Simulating King Kai’s Planet in WebGL

**Project Members:** Reuben Geronimo (rg1090), Orland Geronimo (ogg9)

## Objectives
We set out to recreate King Kai’s Planet from Dragon Ball Z as a small, interactive 3D world in the browser using WebGL. Key goals:
- Visible planetary curvature with strong radial gravity pulling toward the center.
- Physically believable motion, orientation, and camera behavior on a curved surface.
- Smooth lighting/shading and approachable visuals inspired by DBZ.
- User control to move an object around the planet and view from multiple camera perspectives.

## References
- Dragon Ball Z by Akira Toriyama (design/atmosphere inspiration)
- Planetary-physics games (e.g., Outer Wilds) for feel
- MDN WebGL/JavaScript docs for rendering and browser APIs
- Tutorials on spherical gravity and “Super Mario Galaxy” style physics
- Course notes on WebGL transforms and shading

## Progress and Results
- **Planet & Gravity:** Implemented a spherical planet with radial gravity and upright orientation tied to the surface normal.
- **Movement & Camera:** Orbit-style camera with smooth zoom/rotation; keyboard input for movement; objects stay aligned to the curved surface.
- **Lighting & Atmosphere:** Gradient sky, soft shading, and pastel color palette; added visual effects for collisions and orbs.
- **Interaction:** Multiple flying sprites with mutual attraction and collision flashes; basic environment props (house, garage, trees) on the planet.
- **Polish:** Trails, collision bursts, and super-mode visuals; UI sliders/toggles for camera and sprite count; responsive canvas sizing.

## Challenges (planned and addressed)
1. **Modeling the planet:** Balanced scale so curvature is visible but walkable; custom mesh utilities.
2. **Custom gravity:** Radial gravity math and stable orientation along the normal; avoidance of gimbal issues near poles.
3. **Movement/orientation:** Tangent-frame transforms to keep objects upright while moving on a sphere.
4. **Lighting/atmosphere:** Gradient background, soft shading, rim/ambient balance for stylized look.
5. **Camera control:** Orbit camera with constrained pitch and smooth zoom; input handling for keyboard/mouse.
6. **Polish/optimization:** Trail batching, simple collision handling, color/alpha fixes to avoid black sprites.

## Timeline vs. Original Plan (summary)
- Weeks 1–3: Set up WebGL scene, planet mesh, and radial gravity groundwork (met).
- Weeks 4–5: Movement and camera on curved surface (implemented orbit camera and input).
- Weeks 6–7: Lighting/sky and environment props (gradient sky, basic props placed on planet).
- Weeks 8–9: Debugging and polish (collision visuals, UI controls, color fixes, performance tweaks).

## End Goal
A WebGL demo where users explore a small spherical planet with radial gravity, smooth motion/orientation, and stylized visuals—paying homage to King Kai’s Planet while demonstrating 3D rendering, transforms, and custom gravity in the browser.

## Architecture Overview
- **Entry:** `src/js/main.js` initializes WebGL, sets up UI bindings, and drives the frame loop (`updateScene`, `renderScene`).
- **Core scene:** `src/js/scene.js` holds planet/props meshes, gravity/orientation math, camera controls, orb systems, and draw calls.
- **Helpers:** `src/js/geo-helpers.js` builds primitive meshes (boxes, cylinders, spheres, lathes).
- **Shaders:** Inline GLSL strings in `scene.js` for planet, background, orbs, and trails; compiled in `create*Program` helpers.
- **HTML/UI:** `src/index.html` hosts the canvas and a small control panel (camera sliders, sprite count, super toggle).

## Key Code Excerpts
*Radial surface transform (places/aligns objects on the sphere)*  
```1181:1214:src/js/scene.js
function buildSurfaceTransformScaled(radius, lat, lon, baseHeight, scale, yawAroundUp = 0, offsetFactor = 0.9) {
  const surfacePos = [radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.sin(lon)];
  const up = normalize(surfacePos.slice());
  const ref = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let forward = normalize(cross(ref, up));
  const right = normalize(cross(up, forward));
  const offset = (baseHeight * scale) * offsetFactor + 0.003;
  const pos = [surfacePos[0] + up[0] * offset, surfacePos[1] + up[1] * offset, surfacePos[2] + up[2] * offset];
  const m = mat4.create();
  m[0] = right[0]; m[1] = right[1]; m[2] = right[2];
  m[4] = up[0];    m[5] = up[1];    m[6] = up[2];
  m[8] = forward[0]; m[9] = forward[1]; m[10] = forward[2];
  m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2];
  if (yawAroundUp !== 0) mat4.rotate(m, m, yawAroundUp, up);
  mat4.scale(m, m, [scale, scale, scale]);
  return m;
}
```

*Orbit camera update*  
```1236:1251:src/js/scene.js
function updateCameraMatrices(gl) {
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight || 1;
  mat4.perspective(camera.projection, Math.PI / 3, aspect, 0.1, 100.0);
  const sinPhi = Math.sin(camera.phi);
  const eyeX = camera.radius * sinPhi * Math.cos(camera.theta);
  const eyeY = camera.radius * Math.cos(camera.phi);
  const eyeZ = camera.radius * sinPhi * Math.sin(camera.theta);
  mat4.lookAt(camera.view, [eyeX, eyeY, eyeZ], camera.target, [0, 1, 0]);
}
```

*Orb creation and color choice (pastel palette)*  
```82:114:src/js/scene.js
function createOrbState() {
  const baseColor = randomBrightColor(); // pastel-ish
  return { id: orbIdCounter++, name: `Orb ${orbIdCounter - 1}`, angle: Math.random() * Math.PI * 2,
    angularSpeed: 0.6, radius: 1.6, height: 0.2, size: 0.07, trailMax: 220,
    trailPositions: [], trailDirty: true, direction: Math.random() < 0.5 ? -1 : 1,
    targetAngularSpeed: 0.6, targetRadius: 1.6, targetHeight: 0.2,
    segmentTime: 0, segmentDuration: 1.4, pauseTimer: 0, pauseDuration: 0, isPaused: false,
    wobblePhaseA: Math.random() * Math.PI * 2, wobblePhaseB: Math.random() * Math.PI * 2,
    renderRadius: 1.6, renderHeight: 0.2, planeNormal: randomUnitVec3(), targetPlaneNormal: [0, 1, 0],
    teleportPlanned: false, teleportDone: false, skipTrailInterpolation: false,
    color: baseColor, isSuper: false, baseColor };
}

function randomBrightColor() {
  const h = Math.random();
  const s = 0.35 + Math.random() * 0.2;   // pastel saturation
  const v = 0.88 + Math.random() * 0.12;  // bright value
  // hsv → rgb ...
}
```

*Orb render with per-orb colors and collision bursts*  
```2215:2246:src/js/scene.js
for (const orbState of orbStates) {
  const center = currentOrbiterPosition(orbState);
  const colors = getOrbColors(orbState);
  gl.uniform3fv(orbProgram.uCenter, new Float32Array(center));
  gl.uniform1f(orbProgram.uSize, orbState.size);
  gl.uniform3fv(orbProgram.uColorOuter, new Float32Array(colors.outer));
  gl.uniform3fv(orbProgram.uColorInner, new Float32Array(colors.inner));
  gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
}
// bursts (bright white) rendered after orbs
```

*Mutual attraction & collision burst spawn*  
```1980:2011:src/js/scene.js
function applyMutualAttraction(dt) {
  const attractDist = 0.55, attractStrength = 0.35;
  for (let i = 0; i < orbStates.length; i++) for (let j = i + 1; j < orbStates.length; j++) {
    const a = currentOrbiterPosition(orbStates[i]), b = currentOrbiterPosition(orbStates[j]);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], dist = Math.hypot(dx, dy, dz);
    if (dist > 0 && dist < attractDist) {
      const pull = (attractDist - dist) * attractStrength * dt;
      orbStates[i].targetRadius = clampOrbit(orbStates[i].targetRadius - pull * 0.5, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
      orbStates[j].targetRadius = clampOrbit(orbStates[j].targetRadius - pull * 0.5, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
      orbStates[i].targetHeight += (dy / dist) * pull * 0.4;
      orbStates[j].targetHeight -= (dy / dist) * pull * 0.4;
    }
  }
}

function resolveOrbCollisions() {
  const minDist = 0.18;
  for (let i = 0; i < orbStates.length; i++) for (let j = i + 1; j < orbStates.length; j++) {
    const a = currentOrbiterPosition(orbStates[i]), b = currentOrbiterPosition(orbStates[j]);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], dist = Math.hypot(dx, dy, dz);
    if (dist > 0 && dist < minDist) {
      spawnCollisionBurst([(a[0]+b[0])*0.5, (a[1]+b[1])*0.5, (a[2]+b[2])*0.5], orbStates[i].isSuper || orbStates[j].isSuper);
    }
  }
}
```

## Interactive Controls
- **Keyboard:** WASD/Arrow keys rotate/tilt the camera; Q/E (or -/+) zoom.
- **UI panel (top-left):** Sliders for camera theta/phi/zoom; numeric sprite count; per-orb selector with Super toggle.
- **Mouse:** Drag to orbit camera; scroll to zoom.

## Visual & Physics Tuning Knobs
- Gravity/offset per object: `buildSurfaceTransformScaled` (offsetFactor), planet spin speed (`spinPlanet`).
- Orb system: `trailMax`, `size`, attraction radius/strength (`applyMutualAttraction`: 0.55 / 0.35), collision radius (`minDist`: 0.18), burst size/life (`spawnCollisionBurst`: 0.22–0.28, life 0.6s).
- Palette: `randomBrightColor` (saturation/value ranges).
- Sky: `drawBackgroundGradient` colors (`uTop/uMid/uBottom`).

## Known Issues / Future Work
- Simplified collisions: no true rigid body response; only separation and visual bursts.
- No shadows or advanced lighting; single light + gradient sky.
- Orb physics are heuristic (wobble/attraction), not physically accurate orbital mechanics.
- Performance unprofiled for very high orb counts; batching could be improved if scaling up.
- Environment props are static; no interaction with orbs/character yet.
