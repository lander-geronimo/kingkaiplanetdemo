## Camera Math Feature – Implementation Guide

Branch: `feature/camera-math`  
Goal: Add an orbit camera using `gl-matrix` and hook it into `renderScene` so it drives `drawPlanet(gl, view, projection)`.

---

### 1. Ensure `gl-matrix` is available

- In `src/index.html`, make sure `gl-matrix` is loaded before `main.js`, for example:

```html
<script src="https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/gl-matrix-min.js"></script>
<script type="module" src="./js/main.js"></script>
```

- This gives access to `mat4` and `vec3` on `window` (or you can import them in JS if you prefer).

---

### 2. Add camera state in `scene.js`

- Near the top of `src/js/scene.js`, after the planet state, add a camera object:

```js
const camera = {
  radius: 5,          // distance from planet center
  theta: 0.0,         // horizontal angle
  phi: 1.0,           // vertical angle (0 < phi < PI)
  target: [0, 0, 0],  // look-at target (planet center)
  view: mat4.create(),
  projection: mat4.create(),
};
```

---

### 3. Implement basic orbit controls

- In `initScene(gl)`:
  - Get the canvas: `const canvas = gl.canvas;`
  - Add mouse listeners to update `camera.theta` and `camera.phi`:
    - On `mousedown`, start tracking drag.
    - On `mousemove` while dragging, adjust angles based on `event.movementX` and `movementY`.
    - Clamp `phi` to a safe range, e.g. `0.1` to `Math.PI - 0.1` so the camera never flips.
  - Optionally, add `wheel` to zoom by changing `camera.radius` within [minRadius, maxRadius].

Hint for clamping:

```js
camera.phi = Math.max(0.1, Math.min(Math.PI - 0.1, camera.phi));
```

---

### 4. Compute view and projection each frame

- In `updateScene(gl, dt)` (or a helper it calls):

```js
const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
mat4.perspective(camera.projection, Math.PI / 3, aspect, 0.1, 100.0);

const x = camera.radius * Math.sin(camera.phi) * Math.cos(camera.theta);
const y = camera.radius * Math.cos(camera.phi);
const z = camera.radius * Math.sin(camera.phi) * Math.sin(camera.theta);

const eye = [x, y, z];
const up = [0, 1, 0];

mat4.lookAt(camera.view, eye, camera.target, up);
```

- This updates `camera.view` and `camera.projection` every frame based on the current orbit angles and radius.

---

### 5. Use the camera in `renderScene`

- Replace the identity matrices currently used in `renderScene(gl)` with the camera matrices:

```js
export function renderScene(gl) {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawPlanet(gl, camera.view, camera.projection);
}
```

- `drawPlanet` already exists in `scene.js` and expects `view` and `projection` matrices, so this should immediately make the planet:
  - Always round (not stretched),
  - At a controlled size based on `radius` and FOV,
  - Orbitable with mouse input.

---

### 6. Tuning

- Adjust for feel:
  - `camera.radius` initial value (e.g. 4–7).
  - FOV in `mat4.perspective` (e.g. `Math.PI / 3` vs `Math.PI / 4`).
  - Mouse sensitivity (scale `movementX`/`movementY`).
  - Zoom speed and min/max radius.

- Once it feels good, commit on `feature/camera-math` with a message like:

```bash
git add src/index.html src/js/scene.js
git commit -m "Add orbit camera using gl-matrix"
```


