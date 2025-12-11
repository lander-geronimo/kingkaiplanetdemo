// scene.js
// Planet geometry + shaders for King Kai's planet branch.

const { mat4 } = window.glMatrix;
// Helpers for procedural meshes
import {
  buildBox,
  latheProfile,
  buildTriangleStripIndices,
  extrudePositions,
  scalePositions,
  rotateYPositions,
} from "./geo-helpers.js";
import noise from "./noise.js";

// Module-level state for the planet and its shader program
let planet = null;
let planetProgram = null;
let house = null;
let trees = [];
let garage = null;
let road = null;
let roadStripes = [];
let roadCap = null;
let fountain = null;
let glRef = null;

// Background (gradient + clouds) state
let bgProgram = null;
let bgQuadVbo = null;
let bgQuadIbo = null;
let bgTime = 0;
// Clouds disabled, keep placeholders to avoid reference errors
let cloudProgram = null;
let cloudNoiseTex = null;

// Orbiting sprite + trail
let orbProgram = null;
let orbTrailProgram = null;
let orbTrailSpriteProgram = null;
let orbBillboardVbo = null;
let orbTrailVbo = null;
let orbTrailIbo = null;
let orbTrailVertexCount = 0;
let orbStates = [];
let orbCount = 3;
let retiredTrails = [];
let orbIdCounter = 1;

function createOrbState() {
  return {
    id: orbIdCounter++,
    name: `Orb ${orbIdCounter - 1}`,
    angle: Math.random() * Math.PI * 2,
    angularSpeed: 0.6, // radians/sec
    radius: 1.6,
    height: 0.2,
    size: 0.07,
    trailMax: 220,
    trailPositions: [],
    trailDirty: true,
    direction: Math.random() < 0.5 ? -1 : 1,
    targetAngularSpeed: 0.6,
    targetRadius: 1.6,
    targetHeight: 0.2,
    segmentTime: 0,
    segmentDuration: 1.4,
    pauseTimer: 0,
    pauseDuration: 0,
    isPaused: false,
    wobblePhaseA: Math.random() * Math.PI * 2,
    wobblePhaseB: Math.random() * Math.PI * 2,
    renderRadius: 1.6,
    renderHeight: 0.2,
    planeNormal: randomUnitVec3(),
    targetPlaneNormal: [0, 1, 0],
    teleportPlanned: false,
    teleportDone: false,
    skipTrailInterpolation: false,
    isChaser: false,
    targetId: null,
    color: null, // will be derived each frame
  };
}

const ORBIT_MIN_RADIUS = 1.15;
const ORBIT_MAX_RADIUS = 2.05;
const ORBIT_MIN_HEIGHT = -0.35;
const ORBIT_MAX_HEIGHT = 0.75;
const TELEPORT_BREAK_DIST = 0.55;

function clampOrbit(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randomUnitVec3() {
  // Marsaglia method
  const u = randomRange(-1, 1);
  const theta = randomRange(0, Math.PI * 2);
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(theta), u, s * Math.sin(theta)];
}

function lerpVec3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

function normalizeVec3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= len;
  v[1] /= len;
  v[2] /= len;
  return v;
}

function pickNewFlightSegment(orbState, forceFlip = false) {
  if (forceFlip || Math.random() < 0.35) {
    orbState.direction *= -1;
  }
  orbState.segmentTime = 0;
  orbState.segmentDuration = randomRange(0.9, 2.4);
  orbState.targetAngularSpeed = randomRange(0.35, 1.8);

  const nextRadius = randomRange(1.25, 1.95);
  orbState.targetRadius = clampOrbit(nextRadius, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);

  const anywhere = randomRange(-0.32, 0.62);
  const lift = Math.sin(orbState.wobblePhaseA * 0.5 + Math.random() * 0.6) * 0.08;
  const nextHeight = anywhere + lift;
  orbState.targetHeight = clampOrbit(nextHeight, ORBIT_MIN_HEIGHT, ORBIT_MAX_HEIGHT);

  // Occasionally pick a completely new orbit plane so he can loop over poles
  if (forceFlip || Math.random() < 0.6) {
    orbState.targetPlaneNormal = randomUnitVec3();
  }

  orbState.teleportPlanned = false;
  orbState.teleportDone = false;
}

// Orbit camera state
const camera = {
  radius: 4.5,
  minRadius: 2.5,
  maxRadius: 8,
  theta: 0,
  phi: Math.PI / 3,
  target: [0, 0, 0],
  view: mat4.create(),
  projection: mat4.create(),
  isDragging: false,
  lastMouseX: 0,
  lastMouseY: 0,
  rotationSpeed: 0.0035,
  zoomSpeed: 0.15,
};
const cameraInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  zoomIn: false,
  zoomOut: false,
};

// Vertex / fragment shader sources for the planet
const PLANET_VERTEX_SOURCE = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

varying vec3 vNormal;
varying vec3 vWorldPos;

void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vWorldPos = worldPos.xyz;

  // Transform normal by upper-left 3x3 of model matrix
  vNormal = mat3(uModel) * aNormal;

  gl_Position = uProjection * uView * worldPos;
}
`;

const PLANET_FRAGMENT_SOURCE = `
precision mediump float;

varying vec3 vNormal;
varying vec3 vWorldPos;

uniform vec3 uLightDirection;
uniform vec3 uBaseColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(-uLightDirection); // light coming FROM this direction

  // Basic diffuse + ambient
  float diffuse = max(dot(N, L), 0.0);
  float ambient = 0.2;

  // Rim light: stronger near the silhouette (using N.y as a simple proxy)
  float rim = pow(1.0 - max(N.y, 0.0), 2.0);

  float lighting = ambient + diffuse + 0.4 * rim;
  lighting = clamp(lighting, 0.0, 1.5);

  // Vertical gradient based on normal.y
  float t = clamp(0.5 + 0.5 * N.y, 0.0, 1.0);
  vec3 topColor = uBaseColor + vec3(0.1, 0.1, 0.0);      // slightly warmer top
  vec3 bottomColor = uBaseColor * vec3(0.4, 0.6, 1.0);   // cooler bottom
  vec3 base = mix(bottomColor, topColor, t);

  vec3 color = base * lighting;

  gl_FragColor = vec4(color, 1.0);
}
`;

// Fullscreen quad vertex shader (shared by background passes)
const BG_VERTEX_SOURCE = `
attribute vec2 aPosition;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Gradient background fragment: pink upper sky → yellow lower clouds
const BG_FRAGMENT_SOURCE = `
precision mediump float;
varying vec2 vUv;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBottom;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uAspect;
void main() {
  // Reconstruct a world-space view direction so background responds to camera orientation.
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uRight * (ndc.x * uAspect) + uUp * ndc.y + uForward);

  float t = clamp(0.5 + 0.5 * dir.y, 0.0, 1.0);
  float midT = smoothstep(0.35, 0.65, t);
  vec3 upper = mix(uTop, uMid, midT);
  float lowerMix = smoothstep(0.0, 0.4, 1.0 - t);
  vec3 color = mix(upper, uBottom, lowerMix);
  gl_FragColor = vec4(color, 1.0);
}
`;

// Cloud overlay fragment: scrolling noise, masked to lower region, tied to camera orientation
const CLOUD_FRAGMENT_SOURCE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uNoise;
uniform vec2 uUvScale;
uniform vec2 uScroll;
uniform float uTime;
uniform float uMaskHeight;
uniform float uCloudOpacity;
uniform vec3 uCloudColor;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uAspect;

// Convert a direction to simple spherical UV for clouds
vec2 dirToUV(vec3 d) {
  float az = atan(d.z, d.x);          // [-pi, pi]
  float el = asin(clamp(d.y, -1.0, 1.0)); // [-pi/2, pi/2]
  return vec2(az / (2.0 * 3.14159265) + 0.5, el / 3.14159265 + 0.5);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uRight * (ndc.x * uAspect) + uUp * ndc.y + uForward);

  // Mask clouds to the lower/southern dome (favor y < 0)
  float hemiMask = smoothstep(uMaskHeight, uMaskHeight - 0.25, dir.y);

  // Spherical UVs for cloud sampling
  vec2 suv = dirToUV(dir);
  vec2 uv = suv * uUvScale + uScroll * uTime;

  // Simple two-octave fBm to make a fuller carpet
  float n1 = texture2D(uNoise, uv).r;
  float n2 = texture2D(uNoise, uv * 2.3 + 7.1).r;
  float n = mix(n1, n2, 0.35);

  // Soft threshold to get broad puffy areas
  float cloud = smoothstep(0.35, 0.6, n);

  float alpha = cloud * hemiMask * uCloudOpacity;
  gl_FragColor = vec4(uCloudColor, alpha);
}
`;

// 3D cloud billboard shaders
const CLOUD3D_VERTEX_SOURCE = `
attribute vec3 aCenter;
attribute vec2 aOffset;
attribute float aSize;

uniform mat4 uView;
uniform mat4 uProjection;
uniform vec3 uRight;
uniform vec3 uUp;

varying vec2 vUv;

void main() {
  vec3 worldPos = aCenter + (uRight * aOffset.x + uUp * aOffset.y) * aSize;
  vUv = aOffset * 0.5 + 0.5;
  gl_Position = uProjection * uView * vec4(worldPos, 1.0);
}
`;

const CLOUD3D_FRAGMENT_SOURCE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uNoise;
uniform vec3 uColor;
uniform float uSoftness;
uniform float uAlpha;

void main() {
  // Soft round falloff
  float d = length(vUv - 0.5) * 2.0;
  float falloff = smoothstep(1.0, uSoftness, d);

  float n = texture2D(uNoise, vUv * 1.8).r;
  float cloud = smoothstep(0.35, 0.65, n);

  float alpha = cloud * falloff * uAlpha;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// Orbiting sprite billboard
const ORB_VERTEX_SOURCE = `
attribute vec2 aOffset;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uSize;
uniform vec3 uCenter;
varying vec2 vUv;
void main() {
  vec3 worldPos = uCenter + (uRight * aOffset.x + uUp * aOffset.y) * uSize;
  vUv = aOffset * 0.5 + 0.5;
  gl_Position = uProjection * uView * vec4(worldPos, 1.0);
}
`;

const ORB_FRAGMENT_SOURCE = `
precision mediump float;
varying vec2 vUv;
uniform vec3 uColorOuter;
uniform vec3 uColorInner;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float falloff = smoothstep(1.0, 0.0, d);
  float core = smoothstep(0.25, 0.0, d);
  vec3 col = mix(uColorOuter, uColorInner, core);
  gl_FragColor = vec4(col, falloff);
}
`;

// Orbit trail (line strip)
const ORB_TRAIL_VERTEX_SOURCE = `
attribute vec3 aPosition;
attribute float aAlpha;
uniform mat4 uView;
uniform mat4 uProjection;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

const ORB_TRAIL_FRAGMENT_SOURCE = `
precision mediump float;
varying float vAlpha;
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, vAlpha);
}
`;

// Orbit trail sprites (billboarded puffs)
const ORB_TRAIL_SPRITE_VERTEX_SOURCE = `
attribute vec3 aCenter;
attribute vec2 aOffset;
attribute float aSize;
attribute float aAlpha;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 worldPos = aCenter + (uRight * aOffset.x + uUp * aOffset.y) * aSize;
  vUv = aOffset * 0.5 + 0.5;
  vAlpha = aAlpha;
  gl_Position = uProjection * uView * vec4(worldPos, 1.0);
}
`;

const ORB_TRAIL_SPRITE_FRAGMENT_SOURCE = `
precision mediump float;
varying vec2 vUv;
varying float vAlpha;
uniform vec3 uColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float falloff = smoothstep(1.0, 0.0, d);
  float alpha = falloff * vAlpha;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export function initScene(gl) {
  glRef = gl;
  console.log("Scene initialized");

  // Rendering setup
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.frontFace(gl.CCW);
  gl.cullFace(gl.BACK);

  // Deep space-like clear color, slight purple/blue tint
  gl.clearColor(0.02, 0.0, 0.08, 1.0);

  initBackground(gl);
  setupOrbitControls(gl.canvas);
  initPlanet(gl);
  initHouse(gl);
  initGarage(gl);
  initRoad(gl);
  initFountain(gl);
  initTrees(gl);
  initOrbiters(gl);
}

export function updateScene(gl, dt) {
  resizeViewportIfNeeded(gl);
  updateCameraMatrices(gl);
  spinPlanet(dt);
  bgTime += dt;
  applyCameraKeyboard(dt);
  updateOrbiters(dt);
  decayRetiredTrails(dt);
}

export function getCameraState() {
  return {
    theta: camera.theta,
    phi: camera.phi,
    radius: camera.radius,
    minRadius: camera.minRadius,
    maxRadius: camera.maxRadius,
  };
}

export function setCameraState({ theta, phi, radius }) {
  if (typeof theta === "number") camera.theta = theta;
  if (typeof phi === "number") camera.phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));
  if (typeof radius === "number") {
    camera.radius = Math.max(camera.minRadius, Math.min(camera.maxRadius, radius));
  }
}

export function getOrbCount() {
  return orbCount;
}

export function setOrbCount(count) {
  const next = Math.max(1, Math.min(20, Math.floor(count || 1)));
  if (!glRef) {
    orbCount = next;
    return;
  }

  if (!orbStates || !orbStates.length) {
    orbCount = next;
    initOrbiters(glRef);
    return;
  }

  if (next > orbStates.length) {
    const toAdd = next - orbStates.length;
    for (let i = 0; i < toAdd; i++) {
      const state = createOrbState();
      const p = currentOrbiterPosition(state);
      state.trailPositions = [p];
      state.trailDirty = true;
      pickNewFlightSegment(state, true);
      orbStates.push(state);
    }
    assignChasers();
  } else if (next < orbStates.length) {
    while (orbStates.length > next) {
      const removed = orbStates.pop();
      if (removed && removed.trailPositions?.length) {
        const trailColor = getOrbTrailColor(removed);
        retiredTrails.push({
          trailPositions: removed.trailPositions.slice(),
          size: removed.size,
          alphaScale: 1,
          fade: 1.2, // seconds to fade out
          trailDirty: true,
          trailIndexCount: removed.trailIndexCount || 0,
          color: trailColor,
        });
      }
    }
  }

  orbCount = next;
}

export function getOrbiters() {
  return orbStates.map((o) => ({
    id: o.id,
    name: o.name,
    isChaser: o.isChaser,
  }));
}

export function setOrbChaser(id, isChaser) {
  const orb = orbStates.find((o) => o.id === id);
  if (!orb) return;
  if (isChaser) {
    orb.isChaser = true;
    assignTargetFor(orb);
  } else {
    orb.isChaser = false;
    orb.targetId = null;
  }
}

export function renderScene(gl) {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Draw background: gradient only
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);

  drawBackgroundGradient(gl);

  // Restore depth for scene objects
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);

  drawPlanet(gl, camera.view, camera.projection);
  drawHouse(gl, camera.view, camera.projection);
  drawGarage(gl, camera.view, camera.projection);
  drawRoad(gl, camera.view, camera.projection);
  drawFountain(gl, camera.view, camera.projection);
  drawTrees(gl, camera.view, camera.projection);

  // Orbiting sprite + trail (drawn last, depth-tested, no depth writes)
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  const cullWasEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullWasEnabled) gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  drawOrbiterTrail(gl, camera.view, camera.projection);
  drawOrbiter(gl, camera.view, camera.projection);
  gl.disable(gl.BLEND);
  if (cullWasEnabled) gl.enable(gl.CULL_FACE);
  gl.depthMask(true);
}

// Exported so the camera branch can call it directly if desired.
export function drawPlanet(gl, view, projection) {
  if (!planet || !planetProgram) return;

  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.BLEND);

  gl.useProgram(planetProgram);

  const cullEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullEnabled) gl.disable(gl.CULL_FACE); // render double-sided to avoid missing faces

  // Bind position buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, planet.positionBuffer);
  gl.enableVertexAttribArray(planetProgram.aPosition);
  gl.vertexAttribPointer(
    planetProgram.aPosition,
    3,
    gl.FLOAT,
    false,
    0,
    0
  );

  // Bind normal buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, planet.normalBuffer);
  gl.enableVertexAttribArray(planetProgram.aNormal);
  gl.vertexAttribPointer(
    planetProgram.aNormal,
    3,
    gl.FLOAT,
    false,
    0,
    0
  );

  // Bind index buffer
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, planet.indexBuffer);

  // Set matrices
  gl.uniformMatrix4fv(planetProgram.uModel, false, planet.modelMatrix);
  gl.uniformMatrix4fv(planetProgram.uView, false, view);
  gl.uniformMatrix4fv(planetProgram.uProjection, false, projection);

  // Light and planet color (grass-like green)
  gl.uniform3fv(
    planetProgram.uLightDirection,
    new Float32Array([-1.0, -1.0, -0.5])
  );
  gl.uniform3fv(
    planetProgram.uBaseColor,
    new Float32Array([0.2, 0.8, 0.3])
  );

  gl.drawElements(gl.TRIANGLES, planet.indexCount, gl.UNSIGNED_SHORT, 0);

  if (cullEnabled) gl.enable(gl.CULL_FACE);
}

function drawHouse(gl, view, projection) {
  if (!house || !planetProgram) return;
  gl.useProgram(planetProgram);

  // Render house double-sided to avoid seeing through when camera moves.
  const cullEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullEnabled) gl.disable(gl.CULL_FACE);

  const tempModel = mat4.create();

  for (const part of house.parts) {
    gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.positionBuffer);
    gl.enableVertexAttribArray(planetProgram.aPosition);
    gl.vertexAttribPointer(planetProgram.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.normalBuffer);
    gl.enableVertexAttribArray(planetProgram.aNormal);
    gl.vertexAttribPointer(planetProgram.aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indexBuffer);

    mat4.copy(tempModel, house.baseModel);
    if (part.modelOffset) mat4.translate(tempModel, tempModel, part.modelOffset);

    gl.uniformMatrix4fv(planetProgram.uModel, false, tempModel);
    gl.uniformMatrix4fv(planetProgram.uView, false, view);
    gl.uniformMatrix4fv(planetProgram.uProjection, false, projection);
    gl.uniform3fv(planetProgram.uLightDirection, new Float32Array([-1.0, -1.0, -0.5]));
    gl.uniform3fv(planetProgram.uBaseColor, new Float32Array(part.color));

    gl.drawElements(gl.TRIANGLES, part.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  if (cullEnabled) gl.enable(gl.CULL_FACE);
}

function drawTrees(gl, view, projection) {
  if (!trees.length || !planetProgram) return;
  gl.useProgram(planetProgram);

  const temp = mat4.create();
  const cullEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullEnabled) gl.disable(gl.CULL_FACE);

  for (const tree of trees) {
    for (const part of tree.parts) {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.positionBuffer);
      gl.enableVertexAttribArray(planetProgram.aPosition);
      gl.vertexAttribPointer(planetProgram.aPosition, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.normalBuffer);
      gl.enableVertexAttribArray(planetProgram.aNormal);
      gl.vertexAttribPointer(planetProgram.aNormal, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indexBuffer);

      mat4.copy(temp, tree.model);
      if (part.offset) mat4.translate(temp, temp, part.offset);

      gl.uniformMatrix4fv(planetProgram.uModel, false, temp);
      gl.uniformMatrix4fv(planetProgram.uView, false, view);
      gl.uniformMatrix4fv(planetProgram.uProjection, false, projection);
      gl.uniform3fv(planetProgram.uLightDirection, new Float32Array([-1.0, -1.0, -0.5]));
      gl.uniform3fv(planetProgram.uBaseColor, new Float32Array(part.color));

      gl.drawElements(gl.TRIANGLES, part.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  if (cullEnabled) gl.enable(gl.CULL_FACE);
}

function drawGarage(gl, view, projection) {
  if (!garage || !planetProgram) return;
  gl.useProgram(planetProgram);
  const cullEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullEnabled) gl.disable(gl.CULL_FACE);

  gl.bindBuffer(gl.ARRAY_BUFFER, garage.mesh.positionBuffer);
  gl.enableVertexAttribArray(planetProgram.aPosition);
  gl.vertexAttribPointer(planetProgram.aPosition, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, garage.mesh.normalBuffer);
  gl.enableVertexAttribArray(planetProgram.aNormal);
  gl.vertexAttribPointer(planetProgram.aNormal, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, garage.mesh.indexBuffer);

  gl.uniformMatrix4fv(planetProgram.uModel, false, garage.baseModel);
  gl.uniformMatrix4fv(planetProgram.uView, false, view);
  gl.uniformMatrix4fv(planetProgram.uProjection, false, projection);
  gl.uniform3fv(planetProgram.uLightDirection, new Float32Array([-1.0, -1.0, -0.5]));
  gl.uniform3fv(planetProgram.uBaseColor, new Float32Array(garage.color));

  gl.drawElements(gl.TRIANGLES, garage.mesh.indexCount, gl.UNSIGNED_SHORT, 0);

  if (cullEnabled) gl.enable(gl.CULL_FACE);
}

function drawRoad(gl, view, projection) {
  if (!road || !planetProgram) return;
  gl.useProgram(planetProgram);
  const cullEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullEnabled) gl.disable(gl.CULL_FACE);

  const bands = [road, ...roadStripes, roadCap].filter(Boolean);
  for (const band of bands) {
    gl.bindBuffer(gl.ARRAY_BUFFER, band.mesh.positionBuffer);
    gl.enableVertexAttribArray(planetProgram.aPosition);
    gl.vertexAttribPointer(planetProgram.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, band.mesh.normalBuffer);
    gl.enableVertexAttribArray(planetProgram.aNormal);
    gl.vertexAttribPointer(planetProgram.aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, band.mesh.indexBuffer);

    gl.uniformMatrix4fv(planetProgram.uModel, false, band.baseModel);
    gl.uniformMatrix4fv(planetProgram.uView, false, view);
    gl.uniformMatrix4fv(planetProgram.uProjection, false, projection);
    gl.uniform3fv(planetProgram.uLightDirection, new Float32Array([-1.0, -1.0, -0.5]));
    gl.uniform3fv(planetProgram.uBaseColor, new Float32Array(band.color));

    gl.drawElements(gl.TRIANGLES, band.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  if (cullEnabled) gl.enable(gl.CULL_FACE);
}

function drawFountain(gl, view, projection) {
  if (!fountain || !planetProgram) return;
  gl.useProgram(planetProgram);
  const cullEnabled = gl.isEnabled(gl.CULL_FACE);
  if (cullEnabled) gl.disable(gl.CULL_FACE);

  const temp = mat4.create();
  for (const part of fountain.parts) {
    gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.positionBuffer);
    gl.enableVertexAttribArray(planetProgram.aPosition);
    gl.vertexAttribPointer(planetProgram.aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.normalBuffer);
    gl.enableVertexAttribArray(planetProgram.aNormal);
    gl.vertexAttribPointer(planetProgram.aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indexBuffer);

    mat4.copy(temp, fountain.baseModel);
    if (part.modelOffset) mat4.translate(temp, temp, part.modelOffset);

    gl.uniformMatrix4fv(planetProgram.uModel, false, temp);
    gl.uniformMatrix4fv(planetProgram.uView, false, view);
    gl.uniformMatrix4fv(planetProgram.uProjection, false, projection);
    gl.uniform3fv(planetProgram.uLightDirection, new Float32Array([-1.0, -1.0, -0.5]));
    gl.uniform3fv(planetProgram.uBaseColor, new Float32Array(part.color));

    gl.drawElements(gl.TRIANGLES, part.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  if (cullEnabled) gl.enable(gl.CULL_FACE);
}

function initPlanet(gl) {
  // Radius 1.0 sphere, with moderate resolution
  const { positions, normals, indices } = createSphere(1.0, 32, 32);

  // Position buffer
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  // Normal buffer
  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

  // Index buffer
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  planet = {
    positionBuffer,
    normalBuffer,
    indexBuffer,
    indexCount: indices.length,
    // Model matrix as Float32Array (identity) to be compatible with uniformMatrix4fv
    modelMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  };

  planetProgram = createPlanetProgram(gl);
}

function initHouse(gl) {
  // Simpler stable version: hemisphere + box door
  const hemiRadius = 0.6;
  const domeGeom = createHemisphere(hemiRadius, 24, 32);
  const domeMesh = createMesh(gl, domeGeom);

  const doorDims = { w: 0.22, h: 0.28, d: 0.10 }; // wider/taller/deeper box door
  const doorGeom = buildBox(doorDims);
  const doorMesh = createMesh(gl, doorGeom);

  const scale = 0.36;
  const modelMatrix = buildSurfaceTransformScaled(
    1.0,
    Math.PI * 0.18,
    Math.PI * 0.3,
    hemiRadius,
    scale,
    0,
    -0.18
  );

  const doorPush = hemiRadius * scale + doorDims.d * 3.4; // stronger protrusion to edge

  house = {
    parts: [
      { mesh: domeMesh, color: [1.0, 0.92, 0.55], modelOffset: [0, 0, 0] },
      { mesh: doorMesh, color: [1.0, 1.0, 1.0], modelOffset: [0, doorDims.h * 0.6, doorPush] },
    ],
    baseModel: modelMatrix,
  };
}

function initGarage(gl) {
  // Simplified garage: small hemisphere
  const gRadius = 0.32;
  const garageGeom = createHemisphere(gRadius, 16, 24);
  const garageMesh = createMesh(gl, garageGeom);

  const scale = 0.26;
  const modelMatrix = buildSurfaceTransformScaled(
    1.0,
    Math.PI * 0.22,  // a bit higher toward the top
    Math.PI * 0.30 + Math.PI * 0.18, // offset from house, not overlapping fountain
    gRadius,
    scale,
    0,
    -0.30
  );

  garage = {
    mesh: garageMesh,
    color: [0.92, 0.88, 0.78],
    baseModel: modelMatrix,
  };
}

function initRoad(gl) {
  // Belt hugging the planet along a latitude band
  const latCenter = 0.0; // equatorial belt
  const latHalf = 0.12; // wider band
  const latTop = latCenter + latHalf;
  const latBottom = latCenter - latHalf;
  const steps = 128;
  const positions = [];
  const normals = [];
  const indices = [];
  const lift = 1.01; // small outward lift to avoid z-fighting with planet

  for (let i = 0; i <= steps; i++) {
    const lon = (i / steps) * Math.PI * 2;
    const cosLon = Math.cos(lon);
    const sinLon = Math.sin(lon);

    // top edge
    const xTop = Math.cos(latTop) * cosLon;
    const yTop = Math.sin(latTop);
    const zTop = Math.cos(latTop) * sinLon;
    positions.push(xTop, yTop, zTop);
    const lenTop = Math.hypot(xTop, yTop, zTop) || 1;
    normals.push(xTop / lenTop, yTop / lenTop, zTop / lenTop);

    // bottom edge
    const xBot = Math.cos(latBottom) * cosLon;
    const yBot = Math.sin(latBottom);
    const zBot = Math.cos(latBottom) * sinLon;
    positions.push(xBot, yBot, zBot);
    const lenBot = Math.hypot(xBot, yBot, zBot) || 1;
    normals.push(xBot / lenBot, yBot / lenBot, zBot / lenBot);
  }

  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, c, b, d);
  }

  // Lift main road band outward
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= lift;
    positions[i + 1] *= lift;
    positions[i + 2] *= lift;
  }

  const roadMesh = createMesh(gl, { positions, normals, indices });
  const baseModel = mat4.create(); // centered; no extra rotation
  road = {
    mesh: roadMesh,
    color: [0.7, 0.7, 0.7],
    baseModel,
  };

  // Stripes alongside the road
  roadStripes = [];
  const stripeWidth = 0.02;
  const stripeGap = 0.01;
  const stripeHalf = stripeWidth * 0.5;
  const stripeLift = 0.02;

  const topCenter = latTop + stripeGap + stripeHalf;
  const botCenter = latBottom - stripeGap - stripeHalf;
  const stripeBand = (center) => {
    const sTop = center + stripeHalf;
    const sBot = center - stripeHalf;
    const sPositions = [];
    const sNormals = [];
    const sIndices = [];
    for (let i = 0; i <= steps; i++) {
      const lon = (i / steps) * Math.PI * 2;
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);

      const xTop = Math.cos(sTop) * cosLon;
      const yTop = Math.sin(sTop);
      const zTop = Math.cos(sTop) * sinLon;
      // Top row lifted outward
      sPositions.push(xTop * (1 + stripeLift), yTop * (1 + stripeLift), zTop * (1 + stripeLift));
      const lenTop = Math.hypot(xTop, yTop, zTop) || 1;
      sNormals.push(xTop / lenTop, yTop / lenTop, zTop / lenTop);

      const xBot = Math.cos(sBot) * cosLon;
      const yBot = Math.sin(sBot);
      const zBot = Math.cos(sBot) * sinLon;
      // Bottom row stays on the surface to keep contact with planet
      sPositions.push(xBot, yBot, zBot);
      const lenBot = Math.hypot(xBot, yBot, zBot) || 1;
      sNormals.push(xBot / lenBot, yBot / lenBot, zBot / lenBot);
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      sIndices.push(a, b, c, c, b, d);
    }
    // Lift stripe outward
    for (let i = 0; i < sPositions.length; i += 3) {
      sPositions[i] *= lift;
      sPositions[i + 1] *= lift;
      sPositions[i + 2] *= lift;
    }
    return createMesh(gl, { positions: sPositions, normals: sNormals, indices: sIndices });
  };

  roadStripes.push({
    mesh: stripeBand(topCenter),
    color: [0.6, 0.6, 0.6],
    baseModel: mat4.create(),
  });
  roadStripes.push({
    mesh: stripeBand(botCenter),
    color: [0.6, 0.6, 0.6],
    baseModel: mat4.create(),
  });

  // Cap to fill the middle (triangle fan from pole down to latTop)
  const capSteps = steps;
  const capPositions = [0, 1, 0]; // pole center
  const capNormals = [0, 1, 0];
  const capIndices = [];
  const latCap = latTop;
  for (let i = 0; i <= capSteps; i++) {
    const lon = (i / capSteps) * Math.PI * 2;
    const x = Math.cos(latCap) * Math.cos(lon);
    const y = Math.sin(latCap);
    const z = Math.cos(latCap) * Math.sin(lon);
    capPositions.push(x * lift, y * lift, z * lift); // lift cap outward
    const len = Math.hypot(x, y, z) || 1;
    capNormals.push(x / len, y / len, z / len);
  }
  for (let i = 1; i <= capSteps; i++) {
    capIndices.push(0, i, i + 1);
  }
  roadCap = {
    mesh: createMesh(gl, { positions: capPositions, normals: capNormals, indices: capIndices }),
    color: [0.7, 0.7, 0.7],
    baseModel: mat4.create(),
  };
}

function initFountain(gl) {
  // Simplified fountain: short cylinder base + small sphere cap
  const baseHeight = 0.08;
  const baseRadius = 0.20;
  const capRadius = 0.12;

  const baseGeom = createCylinder(baseRadius, baseRadius, baseHeight, 20);
  const capGeom = createSphere(capRadius, 12, 16);
  const baseMesh = createMesh(gl, baseGeom);
  const capMesh = createMesh(gl, capGeom);

  const scale = 0.38;
  const modelMatrix = buildSurfaceTransformScaled(
    1.0,
    Math.PI * 0.24,  // slightly higher toward top
    Math.PI * 0.30 - Math.PI * 0.18, // opposite side from garage
    baseHeight + capRadius,
    scale,
    0,
    -0.08
  );

  fountain = {
    parts: [
      { mesh: baseMesh, color: [0.9, 0.9, 0.95], modelOffset: [0, baseHeight * 0.5, 0] },
      { mesh: capMesh, color: [0.85, 0.85, 0.95], modelOffset: [0, baseHeight + capRadius * 0.8, 0] },
    ],
    baseModel: modelMatrix,
  };
}

function initTrees(gl) {
  trees = [];

  // Broccoli-like: short pale trunk with fuller, larger crowns
  const baseTrunkHeight = 0.22;
  const baseTrunkRadiusBottom = 0.055;
  const baseTrunkRadiusTop = 0.04;
  const baseFoliageRadius = 0.16;

  const trunkGeom = createCylinder(baseTrunkRadiusTop, baseTrunkRadiusBottom, baseTrunkHeight, 12);
  const trunkMesh = createMesh(gl, trunkGeom);
  const foliageGeom = createSphere(baseFoliageRadius, 12, 14);
  const foliageMesh = createMesh(gl, foliageGeom);

  // Procedurally distribute trees around the planet, avoiding other objects
  const treesToPlace = 20;
  const houseLat = Math.PI * 0.18;
  const houseLon = Math.PI * 0.3;
  const garageLat = Math.PI * 0.22;
  const garageLon = Math.PI * 0.30 + Math.PI * 0.18;
  const fountainLat = Math.PI * 0.24;
  const fountainLon = Math.PI * 0.30 - Math.PI * 0.18;
  const roadLatHalf = 0.12; // matches initRoad
  const roadClearance = 0.06; // keep trees off the belt
  const minTreeSeparation = 0.16;
  const latMin = roadLatHalf + roadClearance + 0.02; // just outside the road band
  const poleMargin = 0.08; // avoid exact poles for stability
  const latMax = Math.PI * 0.5 - poleMargin; // nearly up to the poles

  const blockers = [
    { lat: houseLat, lon: houseLon, minAngle: 0.32 },
    { lat: garageLat, lon: garageLon, minAngle: 0.26 },
    { lat: fountainLat, lon: fountainLon, minAngle: 0.24 },
  ];

  const placements = [];

  const isPlacementClear = (lat, lon) => {
    if (Math.abs(lat) < roadLatHalf + roadClearance) return false;
    for (const blocker of blockers) {
      if (angularSeparation(lat, lon, blocker.lat, blocker.lon) < blocker.minAngle) {
        return false;
      }
    }
    for (const existing of placements) {
      if (angularSeparation(lat, lon, existing.lat, existing.lon) < minTreeSeparation) {
        return false;
      }
    }
    return true;
  };

  const tryAddPlacement = (lat, lon) => {
    if (isPlacementClear(lat, lon)) {
      placements.push({ lat, lon });
      return true;
    }
    return false;
  };

  let attempts = 0;
  const maxAttempts = treesToPlace * 30;
  while (placements.length < treesToPlace && attempts < maxAttempts) {
    attempts++;
    const hemisphere = Math.random() < 0.5 ? -1 : 1; // both hemispheres
    const lat = hemisphere * (latMin + Math.random() * (latMax - latMin));
    const lon = Math.random() * Math.PI * 2;
    tryAddPlacement(lat, lon);
  }

  // Ensure some trees opposite the house/road, spreading across hemispheres
  const extra = [
    { lat: houseLat + 0.02, lon: houseLon + Math.PI },
    { lat: -(houseLat + 0.05), lon: houseLon + Math.PI + 0.25 },
    { lat: -(houseLat - 0.03), lon: houseLon + Math.PI - 0.2 },
  ];
  extra.forEach((p) => tryAddPlacement(p.lat, p.lon));

  placements.forEach((p, idx) => {
    const n = noise.perlin2(Math.cos(p.lat + idx) * 2.3, Math.sin(p.lon + idx) * 2.3);
    const scaleJitter = 0.9 + 0.25 * n;
    const trunkHeight = baseTrunkHeight * scaleJitter;
    const foliageRadius = baseFoliageRadius * (0.92 + 0.28 * noise.perlin2(p.lat * 3.1, p.lon * 3.7));
    const modelScale = 0.58 * scaleJitter;
    const model = buildSurfaceTransformScaled(1.0, p.lat, p.lon, trunkHeight + foliageRadius, modelScale, 0, -0.12);

    trees.push({
      model,
      parts: [
        { mesh: trunkMesh, color: [0.94, 0.92, 0.88], offset: [0, trunkHeight * 0.5, 0] },
        { mesh: foliageMesh, color: [0.11, 0.55, 0.11], offset: [0.03, trunkHeight + foliageRadius * 0.35, 0.02] },
        { mesh: foliageMesh, color: [0.13, 0.60, 0.12], offset: [-0.02, trunkHeight + foliageRadius * 0.85, 0.03] },
        { mesh: foliageMesh, color: [0.10, 0.50, 0.10], offset: [0.02, trunkHeight + foliageRadius * 1.35, -0.03] },
      ],
    });
  });
}

function createMesh(gl, geom) {
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.positions), gl.STATIC_DRAW);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.normals), gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geom.indices), gl.STATIC_DRAW);

  return {
    positionBuffer,
    normalBuffer,
    indexBuffer,
    indexCount: geom.indices.length,
  };
}

function buildSurfaceTransformScaled(radius, lat, lon, baseHeight, scale, yawAroundUp = 0, offsetFactor = 0.9) {
  // Position so local +Y aligns with planet normal, +Z is tangent "forward", +X is right.
  const surfacePos = [
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon),
  ];
  const up = normalize(surfacePos.slice()); // outward normal

  // Choose a stable reference to build tangent; avoid degeneracy near poles.
  const ref = Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let forward = cross(ref, up);
  if (length(forward) < 1e-4) forward = [1, 0, 0];
  forward = normalize(forward);
  const right = normalize(cross(up, forward));

  // Position slightly above the surface to avoid clipping.
  const epsilon = 0.003;
  const offset = (baseHeight * scale) * offsetFactor + epsilon;
  const pos = [
    surfacePos[0] + up[0] * offset,
    surfacePos[1] + up[1] * offset,
    surfacePos[2] + up[2] * offset,
  ];

  // Column-major mat4: right (X), up (Y), forward (Z), translation, then yaw and scale.
  const m = mat4.create();
  m[0] = right[0];   m[1] = right[1];   m[2] = right[2];
  m[4] = up[0];      m[5] = up[1];      m[6] = up[2];
  m[8] = forward[0]; m[9] = forward[1]; m[10] = forward[2];
  m[12] = pos[0];    m[13] = pos[1];    m[14] = pos[2];
  if (yawAroundUp !== 0) mat4.rotate(m, m, yawAroundUp, up);
  mat4.scale(m, m, [scale, scale, scale]);
  return m;
}

// Angular separation between two lat/lon points (radians)
function angularSeparation(lat1, lon1, lat2, lon2) {
  const sin1 = Math.sin(lat1), cos1 = Math.cos(lat1);
  const sin2 = Math.sin(lat2), cos2 = Math.cos(lat2);
  const dLon = lon1 - lon2;
  return Math.acos(sin1 * sin2 + cos1 * cos2 * Math.cos(dLon));
}

function computeNormals(positions, indices) {
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v) || 1;
  v[0] /= len; v[1] /= len; v[2] /= len;
  return v;
}

function setupOrbitControls(canvas) {
  canvas.addEventListener("mousedown", handleMouseDown);
  window.addEventListener("mouseup", handleMouseUp);
  window.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
}

function handleMouseDown(event) {
  camera.isDragging = true;
  camera.lastMouseX = event.clientX;
  camera.lastMouseY = event.clientY;
}

function handleMouseUp() {
  camera.isDragging = false;
}

function handleMouseMove(event) {
  if (!camera.isDragging) return;

  const deltaX =
    typeof event.movementX === "number"
      ? event.movementX
      : event.clientX - camera.lastMouseX;
  const deltaY =
    typeof event.movementY === "number"
      ? event.movementY
      : event.clientY - camera.lastMouseY;

  camera.theta += deltaX * camera.rotationSpeed;
  camera.phi -= deltaY * camera.rotationSpeed;

  const minPhi = 0.1;
  const maxPhi = Math.PI - 0.1;
  camera.phi = Math.max(minPhi, Math.min(maxPhi, camera.phi));

  camera.lastMouseX = event.clientX;
  camera.lastMouseY = event.clientY;
}

function handleWheel(event) {
  event.preventDefault();

  const delta = event.deltaY * camera.zoomSpeed * 0.01;
  camera.radius = Math.max(
    camera.minRadius,
    Math.min(camera.maxRadius, camera.radius + delta)
  );
}

function handleKeyDown(event) {
  switch (event.key.toLowerCase()) {
    case "a":
    case "arrowleft":
      cameraInput.left = true;
      break;
    case "d":
    case "arrowright":
      cameraInput.right = true;
      break;
    case "w":
    case "arrowup":
      cameraInput.up = true;
      break;
    case "s":
    case "arrowdown":
      cameraInput.down = true;
      break;
    case "q":
    case "-":
      cameraInput.zoomIn = true;
      break;
    case "e":
    case "+":
    case "=":
      cameraInput.zoomOut = true;
      break;
    default:
      break;
  }
}

function handleKeyUp(event) {
  switch (event.key.toLowerCase()) {
    case "a":
    case "arrowleft":
      cameraInput.left = false;
      break;
    case "d":
    case "arrowright":
      cameraInput.right = false;
      break;
    case "w":
    case "arrowup":
      cameraInput.up = false;
      break;
    case "s":
    case "arrowdown":
      cameraInput.down = false;
      break;
    case "q":
    case "-":
      cameraInput.zoomIn = false;
      break;
    case "e":
    case "+":
    case "=":
      cameraInput.zoomOut = false;
      break;
    default:
      break;
  }
}

function applyCameraKeyboard(dt) {
  const rotSpeed = 1.4 * dt;
  const zoomDelta = camera.zoomSpeed * 1.2;
  if (cameraInput.left) camera.theta -= rotSpeed;
  if (cameraInput.right) camera.theta += rotSpeed;
  if (cameraInput.up) camera.phi = Math.max(0.1, camera.phi - rotSpeed);
  if (cameraInput.down) camera.phi = Math.min(Math.PI - 0.1, camera.phi + rotSpeed);
  if (cameraInput.zoomIn) camera.radius = Math.max(camera.minRadius, camera.radius - zoomDelta);
  if (cameraInput.zoomOut) camera.radius = Math.min(camera.maxRadius, camera.radius + zoomDelta);
}

function updateCameraMatrices(gl) {
  const canvas = gl.canvas;
  const aspect = canvas.clientWidth / canvas.clientHeight || 1;

  mat4.perspective(camera.projection, Math.PI / 3, aspect, 0.1, 100.0);

  const sinPhi = Math.sin(camera.phi);
  const eyeX = camera.radius * sinPhi * Math.cos(camera.theta);
  const eyeY = camera.radius * Math.cos(camera.phi);
  const eyeZ = camera.radius * sinPhi * Math.sin(camera.theta);

  const eye = [eyeX, eyeY, eyeZ];
  const up = [0, 1, 0];

  mat4.lookAt(camera.view, eye, camera.target, up);
}

// Keep canvas and viewport in sync with display size (handles HiDPI).
function resizeViewportIfNeeded(gl) {
  const canvas = gl.canvas;
  const dpr = window.devicePixelRatio || 1;
  const displayWidth = Math.floor(canvas.clientWidth * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr);

  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
}

// Optional: gentle planet spin to show motion/verify transforms.
function spinPlanet(dt) {
  if (!planet) return;
  const speed = 0.3; // radians/sec
  const angle = speed * dt;
  const m = planet.modelMatrix;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const m00 = m[0], m02 = m[2], m10 = m[4], m12 = m[6], m20 = m[8], m22 = m[10];

  m[0] = m00 * cosA + m02 * -sinA;
  m[2] = m00 * sinA + m02 * cosA;
  m[4] = m10 * cosA + m12 * -sinA;
  m[6] = m10 * sinA + m12 * cosA;
  m[8] = m20 * cosA + m22 * -sinA;
  m[10] = m20 * sinA + m22 * cosA;
}

function createPlanetProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, PLANET_VERTEX_SOURCE);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, PLANET_FRAGMENT_SOURCE);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  program.aPosition = gl.getAttribLocation(program, "aPosition");
  program.aNormal = gl.getAttribLocation(program, "aNormal");

  program.uModel = gl.getUniformLocation(program, "uModel");
  program.uView = gl.getUniformLocation(program, "uView");
  program.uProjection = gl.getUniformLocation(program, "uProjection");
  program.uLightDirection = gl.getUniformLocation(program, "uLightDirection");
  program.uBaseColor = gl.getUniformLocation(program, "uBaseColor");

  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

// Simple UV sphere generator: returns positions, normals, indices
function createSphere(radius, latBands, longBands) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= longBands; lon++) {
      const phi = (lon * 2 * Math.PI) / longBands;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;

      positions.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z);
    }
  }

  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < longBands; lon++) {
      const first = lat * (longBands + 1) + lon;
      const second = first + longBands + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { positions, normals, indices };
}

// Hemisphere generator (upper half of sphere) aligned on +Y
function createHemisphere(radius, latBands, longBands) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let lat = 0; lat <= latBands / 2; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= longBands; lon++) {
      const phi = (lon * 2 * Math.PI) / longBands;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;

      positions.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z);
    }
  }

  for (let lat = 0; lat < latBands / 2; lat++) {
    for (let lon = 0; lon < longBands; lon++) {
      const first = lat * (longBands + 1) + lon;
      const second = first + longBands + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { positions, normals, indices };
}

// Simple cylinder generator (caps optional: capped both ends)
function createCylinder(radiusTop, radiusBottom, height, radialSubdiv) {
  const positions = [];
  const normals = [];
  const indices = [];

  const halfH = height * 0.5;
  for (let yStep = 0; yStep <= 1; yStep++) {
    const y = yStep === 0 ? -halfH : halfH;
    const r = yStep === 0 ? radiusBottom : radiusTop;
    for (let i = 0; i <= radialSubdiv; i++) {
      const theta = (i / radialSubdiv) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      positions.push(r * cos, y, r * sin);
      normals.push(cos, 0, sin);
    }
  }
  const vertsPerRing = radialSubdiv + 1;
  for (let i = 0; i < radialSubdiv; i++) {
    const a = i;
    const b = i + vertsPerRing;
    const c = a + 1;
    const d = b + 1;
    indices.push(a, b, c, c, b, d);
  }
  return { positions, normals, indices };
}

// ---------- Background helpers ----------

function initBackground(gl) {
  // Quad geometry (clip-space)
  const quadVerts = new Float32Array([
    // x,   y,   u,  v
    -1, -1, 0, 0,
     1, -1, 1, 0,
     1,  1, 1, 1,
    -1,  1, 0, 1,
  ]);
  const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  bgQuadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bgQuadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  bgQuadIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bgQuadIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices, gl.STATIC_DRAW);

  bgProgram = createBackgroundProgram(gl);
}

function drawBackgroundGradient(gl) {
  if (!bgProgram) return;
  gl.useProgram(bgProgram.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, bgQuadVbo);
  gl.enableVertexAttribArray(bgProgram.aPosition);
  gl.vertexAttribPointer(bgProgram.aPosition, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(bgProgram.aUv);
  gl.vertexAttribPointer(bgProgram.aUv, 2, gl.FLOAT, false, 16, 8);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bgQuadIbo);

  // Sky gradient: pink upper half blending to warm yellow lower half
  gl.uniform3fv(bgProgram.uTop, new Float32Array([0.94, 0.60, 0.88]));   // dominant pink
  gl.uniform3fv(bgProgram.uMid, new Float32Array([0.95, 0.66, 0.84]));   // pink-heavy transition
  gl.uniform3fv(bgProgram.uBottom, new Float32Array([0.96, 0.74, 0.70])); // pink-washed yellow at the base
  setCameraBasisUniforms(gl, bgProgram);

  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function drawBackgroundClouds(gl) {
  return; // clouds disabled
}

function createBackgroundProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, BG_VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, BG_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Background program link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    aPosition: gl.getAttribLocation(program, "aPosition"),
    aUv: gl.getAttribLocation(program, "aUv"),
    uTop: gl.getUniformLocation(program, "uTop"),
    uMid: gl.getUniformLocation(program, "uMid"),
    uBottom: gl.getUniformLocation(program, "uBottom"),
    uRight: gl.getUniformLocation(program, "uRight"),
    uUp: gl.getUniformLocation(program, "uUp"),
    uForward: gl.getUniformLocation(program, "uForward"),
    uAspect: gl.getUniformLocation(program, "uAspect"),
  };
}

function createCloudProgram(gl) {
  return null; // clouds disabled
}

function createNoiseTexture(gl, size = 256) {
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, size, size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function initClouds3D(gl) {
  const clouds = createCloudBillboards(22, 1.25, -0.35, -0.9);
  cloudBillboardCount = clouds.quadCount;

  cloudBillboardVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cloudBillboardVbo);
  gl.bufferData(gl.ARRAY_BUFFER, clouds.vertices, gl.STATIC_DRAW);

  cloudBillboardIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cloudBillboardIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, clouds.indices, gl.STATIC_DRAW);

  cloud3DProgram = createCloud3DProgram(gl);
}

function drawClouds3D(gl, view, projection) {
  if (!cloud3DProgram || !cloudBillboardVbo) return;

  gl.useProgram(cloud3DProgram.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, cloudBillboardVbo);
  gl.enableVertexAttribArray(cloud3DProgram.aCenter);
  gl.vertexAttribPointer(cloud3DProgram.aCenter, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(cloud3DProgram.aOffset);
  gl.vertexAttribPointer(cloud3DProgram.aOffset, 2, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(cloud3DProgram.aSize);
  gl.vertexAttribPointer(cloud3DProgram.aSize, 1, gl.FLOAT, false, 28, 20);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cloudBillboardIbo);

  gl.uniformMatrix4fv(cloud3DProgram.uView, false, view);
  gl.uniformMatrix4fv(cloud3DProgram.uProjection, false, projection);

  const m = camera.view;
  const right = [m[0], m[4], m[8]];
  const up = [m[1], m[5], m[9]];
  gl.uniform3fv(cloud3DProgram.uRight, new Float32Array(right));
  gl.uniform3fv(cloud3DProgram.uUp, new Float32Array(up));

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, cloudNoiseTex);
  gl.uniform1i(cloud3DProgram.uNoise, 0);

  gl.uniform3fv(cloud3DProgram.uColor, new Float32Array([1.0, 0.92, 0.60]));
  gl.uniform1f(cloud3DProgram.uSoftness, 0.6);
  gl.uniform1f(cloud3DProgram.uAlpha, 0.8);

  gl.drawElements(gl.TRIANGLES, cloudBillboardCount * 6, gl.UNSIGNED_SHORT, 0);
}

function createCloud3DProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, CLOUD3D_VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, CLOUD3D_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Cloud3D program link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    aCenter: gl.getAttribLocation(program, "aCenter"),
    aOffset: gl.getAttribLocation(program, "aOffset"),
    aSize: gl.getAttribLocation(program, "aSize"),
    uView: gl.getUniformLocation(program, "uView"),
    uProjection: gl.getUniformLocation(program, "uProjection"),
    uRight: gl.getUniformLocation(program, "uRight"),
    uUp: gl.getUniformLocation(program, "uUp"),
    uNoise: gl.getUniformLocation(program, "uNoise"),
    uColor: gl.getUniformLocation(program, "uColor"),
    uSoftness: gl.getUniformLocation(program, "uSoftness"),
    uAlpha: gl.getUniformLocation(program, "uAlpha"),
  };
}

function createCloudBillboards(count, radius, minY, maxY) {
  const centers = [];
  const offsets = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const vertices = [];
  const indices = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const y = Math.random() * (maxY - minY) + minY; // negative for southern band
    const rXZ = Math.sqrt(Math.max(0, 1.0 - y * y)) * radius;
    const x = Math.cos(theta) * rXZ;
    const z = Math.sin(theta) * rXZ;
    const size = 0.25 + Math.random() * 0.22;
    centers.push([x, y, z, size]);
  }

  let vertIndex = 0;
  for (const c of centers) {
    for (const o of offsets) {
      vertices.push(c[0], c[1], c[2], o[0], o[1], c[3]);
    }
    indices.push(
      vertIndex + 0,
      vertIndex + 1,
      vertIndex + 2,
      vertIndex + 0,
      vertIndex + 2,
      vertIndex + 3
    );
    vertIndex += 4;
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint16Array(indices),
    quadCount: count,
  };
}

function setCameraBasisUniforms(gl, programInfo) {
  if (!programInfo.uRight || !programInfo.uUp || !programInfo.uForward || !programInfo.uAspect) return;
  const m = camera.view;
  // View matrix from lookAt: columns store camera basis; forward is negative Z column.
  const right = [m[0], m[4], m[8]];
  const up = [m[1], m[5], m[9]];
  const forward = [-m[2], -m[6], -m[10]];
  gl.uniform3fv(programInfo.uRight, new Float32Array(right));
  gl.uniform3fv(programInfo.uUp, new Float32Array(up));
  gl.uniform3fv(programInfo.uForward, new Float32Array(forward));
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight || 1;
  gl.uniform1f(programInfo.uAspect, aspect);
}

// ---------- Orbiting sprite + trail ----------

function initOrbiters(gl) {
  orbProgram = createOrbProgram(gl);
  orbTrailProgram = createOrbTrailProgram(gl);
  orbTrailSpriteProgram = createOrbTrailSpriteProgram(gl);

  // Billboard quad (shared)
  const quad = new Float32Array([
    // offset x, y
    -1, -1,
    1, -1,
    1, 1,
    -1, 1,
  ]);
  orbBillboardVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, orbBillboardVbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  // Trail buffers (dynamic quads)
  orbTrailVbo = gl.createBuffer();
  orbTrailIbo = gl.createBuffer();

  // Seed states
  orbStates = [];
  for (let i = 0; i < orbCount; i++) {
    const state = createOrbState();
    const p = currentOrbiterPosition(state);
    state.trailPositions = [p];
    state.trailDirty = true;
    pickNewFlightSegment(state, true);
    orbStates.push(state);
  }
  assignChasers();
}

function updateOrbiters(dt) {
  for (const orb of orbStates) {
    updateSingleOrb(orb, dt);
    if (orb.isChaser && orb.targetId) {
      steerChaser(orb);
    }
  }
  resolveOrbCollisions();
}

function decayRetiredTrails(dt) {
  if (!retiredTrails.length) return;
  for (let i = retiredTrails.length - 1; i >= 0; i--) {
    const r = retiredTrails[i];
    r.fade -= dt;
    if (r.fade <= 0) {
      retiredTrails.splice(i, 1);
    } else {
      r.alphaScale = Math.max(0, r.fade / 1.2);
      r.trailDirty = true;
    }
  }
}

function updateSingleOrb(orbState, dt) {
  // Layered wobble for erratic movement without clipping the planet
  orbState.wobblePhaseA += dt * 2.6;
  orbState.wobblePhaseB += dt * 3.7;

  // Smoothly reorient the orbit plane toward its target
  lerpVec3(orbState.planeNormal, orbState.planeNormal, orbState.targetPlaneNormal, Math.min(1, dt * 1.8));
  normalizeVec3(orbState.planeNormal);

  if (orbState.isPaused) {
    orbState.pauseTimer -= dt;
    // Mid-hover chance to intentionally teleport
    if (
      orbState.teleportPlanned &&
      !orbState.teleportDone &&
      orbState.pauseTimer <= orbState.pauseDuration * 0.4
    ) {
      performTeleport(orbState);
      orbState.teleportDone = true;
    }
    orbState.angularSpeed += (0 - orbState.angularSpeed) * Math.min(1, dt * 6);
    if (orbState.pauseTimer <= 0) {
      orbState.isPaused = false;
      pickNewFlightSegment(orbState);
    }
  } else {
    const speedJitter = 1 + 0.35 * Math.sin(orbState.wobblePhaseA * 0.7);
    const targetSpeed = orbState.targetAngularSpeed * speedJitter;
    orbState.angularSpeed += (targetSpeed - orbState.angularSpeed) * Math.min(1, dt * 3.5);
    orbState.angle += orbState.angularSpeed * orbState.direction * dt;

    orbState.radius += (orbState.targetRadius - orbState.radius) * Math.min(1, dt * 2.2);
    orbState.height += (orbState.targetHeight - orbState.height) * Math.min(1, dt * 2.2);

    orbState.segmentTime += dt;
    if (orbState.segmentTime >= orbState.segmentDuration) {
      if (Math.random() < 0.3) {
        orbState.isPaused = true;
        orbState.pauseDuration = randomRange(0.35, 0.9);
        orbState.pauseTimer = orbState.pauseDuration;
        orbState.teleportPlanned = Math.random() < 0.45; // sometimes he blinks to a new line mid-hover
        orbState.teleportDone = false;
        orbState.segmentTime = 0;
      } else {
        pickNewFlightSegment(orbState);
      }
    }
  }

  // Apply wobble and safety clamps to keep above the surface
  const radialWobble =
    Math.sin(orbState.wobblePhaseA) * 0.08 +
    Math.sin(orbState.wobblePhaseB + 1.1) * 0.05;
  const verticalWobble =
    Math.sin(orbState.wobblePhaseA * 1.3 + 0.4) * 0.05 +
    Math.sin(orbState.wobblePhaseB * 0.6 + 1.1) * 0.035;

  orbState.renderRadius = clampOrbit(
    orbState.radius + radialWobble,
    ORBIT_MIN_RADIUS,
    ORBIT_MAX_RADIUS
  );
  orbState.renderHeight = clampOrbit(
    orbState.height + verticalWobble,
    ORBIT_MIN_HEIGHT,
    ORBIT_MAX_HEIGHT
  );

  const p = currentOrbiterPosition(orbState);
  const trail = orbState.trailPositions;
  const last = trail[trail.length - 1] || p;

  const dx = p[0] - last[0];
  const dy = p[1] - last[1];
  const dz = p[2] - last[2];
  const dist = Math.hypot(dx, dy, dz);

  if (orbState.skipTrailInterpolation || dist > TELEPORT_BREAK_DIST) {
    trail.push(p);
    orbState.skipTrailInterpolation = false;
  } else {
    const maxGap = 0.045; // tighter spacing at high speed to avoid dotting
    const steps = Math.max(1, Math.ceil(dist / maxGap));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const lerped = [
        last[0] + dx * t,
        last[1] + dy * t,
        last[2] + dz * t,
      ];
      trail.push(lerped);
    }
  }

  while (trail.length > orbState.trailMax) trail.shift();
  orbState.trailDirty = true;
}

function assignChasers() {
  if (orbStates.length < 2) return;
  // Clear existing chase tags
  orbStates.forEach((o) => {
    o.isChaser = false;
    o.targetId = null;
  });

  // 30% of orbs become chasers
  const indices = orbStates.map((_, i) => i);
  const chaserCount = Math.max(1, Math.floor(orbStates.length * 0.3));
  for (let i = 0; i < chaserCount; i++) {
    const idx = Math.floor(Math.random() * indices.length);
    const orbIdx = indices.splice(idx, 1)[0];
    const orb = orbStates[orbIdx];
    orb.isChaser = true;
    assignTargetFor(orb);
  }
}

function assignTargetFor(orb) {
  const targets = orbStates.filter((o) => o.id !== orb.id);
  if (!targets.length) {
    orb.targetId = null;
    return;
  }
  const target = targets[Math.floor(Math.random() * targets.length)];
  orb.targetId = target.id;
  // Speed up chasers a bit
  orb.targetAngularSpeed = Math.max(orb.targetAngularSpeed, 1.1);
}

function resolveOrbCollisions() {
  const minDist = 0.18; // approximate sprite diameter for bounce
  for (let i = 0; i < orbStates.length; i++) {
    for (let j = i + 1; j < orbStates.length; j++) {
      const a = currentOrbiterPosition(orbStates[i]);
      const b = currentOrbiterPosition(orbStates[j]);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 0 && dist < minDist) {
        // simple bounce: push apart and flip directions
        const overlap = (minDist - dist) * 0.5;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        orbStates[i].renderRadius += overlap * 0.05;
        orbStates[j].renderRadius += overlap * 0.05;
        orbStates[i].direction *= -1;
        orbStates[j].direction *= -1;
        orbStates[i].angle += 0.2;
        orbStates[j].angle -= 0.2;
      }
    }
  }
}

function steerChaser(orb) {
  const target = orbStates.find((o) => o.id === orb.targetId);
  if (!target) return;
  const p = currentOrbiterPosition(orb);
  const t = currentOrbiterPosition(target);
  // Desired plane normal is perpendicular to both positions so the orbit plane passes near both.
  let desired = cross(p, t);
  const len = length(desired);
  if (len < 1e-4) return;
  desired = desired.map((v) => v / len);
  orb.targetPlaneNormal = desired;
  // Bias speed up a bit while chasing
  orb.targetAngularSpeed = Math.max(orb.targetAngularSpeed, 1.3);
}

function getOrbColors(orb) {
  if (orb.isChaser) {
    return {
      outer: [1.0, 0.42, 0.42],
      inner: [1.0, 0.78, 0.60],
      trail: [1.0, 0.55, 0.55],
    };
  }
  return {
    outer: [1.0, 1.0, 1.0],
    inner: [0.85, 0.85, 0.9],
    trail: [1.0, 1.0, 1.0],
  };
}

function getOrbTrailColor(orb) {
  return getOrbColors(orb).trail;
}

function currentOrbiterPosition(orbState) {
  const a = orbState.angle;
  const r = orbState.renderRadius ?? orbState.radius;
  const h = orbState.renderHeight ?? orbState.height;

  // Build an orthonormal basis for the orbit plane so he can fly over any latitude
  const n = orbState.planeNormal;
  // Pick a helper vector that is not parallel to n
  const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const right = normalizeVec3([
    n[1] * helper[2] - n[2] * helper[1],
    n[2] * helper[0] - n[0] * helper[2],
    n[0] * helper[1] - n[1] * helper[0],
  ]);
  const forward = [
    right[1] * n[2] - right[2] * n[1],
    right[2] * n[0] - right[0] * n[2],
    right[0] * n[1] - right[1] * n[0],
  ];

  const x = right[0] * Math.cos(a) * r + forward[0] * Math.sin(a) * r + n[0] * h;
  const y = right[1] * Math.cos(a) * r + forward[1] * Math.sin(a) * r + n[1] * h;
  const z = right[2] * Math.cos(a) * r + forward[2] * Math.sin(a) * r + n[2] * h;
  return [x, y, z];
}

function performTeleport(orbState) {
  // Pick a new plane, radius/height, and angle, then reset the trail so the jump looks intentional.
  const newNormal = randomUnitVec3();
  orbState.planeNormal = normalizeVec3(newNormal.slice());
  orbState.targetPlaneNormal = orbState.planeNormal.slice();

  orbState.angle = randomRange(0, Math.PI * 2);
  orbState.radius = orbState.renderRadius = clampOrbit(randomRange(1.2, 1.95), ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
  orbState.height = orbState.renderHeight = clampOrbit(randomRange(-0.25, 0.55), ORBIT_MIN_HEIGHT, ORBIT_MAX_HEIGHT);

  // Next trail update should not interpolate across the jump
  orbState.skipTrailInterpolation = true;
}

function drawOrbiter(gl, view, projection) {
  if (!orbProgram || !orbBillboardVbo || !orbStates.length) return;
  gl.useProgram(orbProgram.program);

  // Camera basis
  const m = camera.view;
  const right = [m[0], m[4], m[8]];
  const up = [m[1], m[5], m[9]];
  gl.uniform3fv(orbProgram.uRight, new Float32Array(right));
  gl.uniform3fv(orbProgram.uUp, new Float32Array(up));

  gl.bindBuffer(gl.ARRAY_BUFFER, orbBillboardVbo);
  gl.enableVertexAttribArray(orbProgram.aOffset);
  gl.vertexAttribPointer(orbProgram.aOffset, 2, gl.FLOAT, false, 8, 0);

  for (const orbState of orbStates) {
    const center = currentOrbiterPosition(orbState);
    const colors = getOrbColors(orbState);
    gl.uniform3fv(orbProgram.uCenter, new Float32Array(center));
    gl.uniformMatrix4fv(orbProgram.uView, false, view);
    gl.uniformMatrix4fv(orbProgram.uProjection, false, projection);
    gl.uniform1f(orbProgram.uSize, orbState.size);
    gl.uniform3fv(orbProgram.uColorOuter, new Float32Array(colors.outer));
    gl.uniform3fv(orbProgram.uColorInner, new Float32Array(colors.inner));

    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }
}

function drawOrbiterTrail(gl, view, projection) {
  if (!orbTrailSpriteProgram || !orbTrailVbo || !orbTrailIbo) return;
  if (!orbStates.length && !retiredTrails.length) return;

  gl.useProgram(orbTrailSpriteProgram.program);
  gl.uniformMatrix4fv(orbTrailSpriteProgram.uView, false, view);
  gl.uniformMatrix4fv(orbTrailSpriteProgram.uProjection, false, projection);

  const m = camera.view;
  const right = [m[0], m[4], m[8]];
  const up = [m[1], m[5], m[9]];
  gl.uniform3fv(orbTrailSpriteProgram.uRight, new Float32Array(right));
  gl.uniform3fv(orbTrailSpriteProgram.uUp, new Float32Array(up));

  gl.bindBuffer(gl.ARRAY_BUFFER, orbTrailVbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, orbTrailIbo);

  const stride = 7 * 4;

  const renderables = [...orbStates, ...retiredTrails];

  for (const orbState of renderables) {
    if (!orbState.trailPositions.length) continue;
    const color = orbState.color || (orbState.id ? getOrbTrailColor(orbState) : [1, 1, 1]);
    gl.uniform3fv(orbTrailSpriteProgram.uColor, new Float32Array(color));

    // Rebuild trail quad geometry when dirty
    if (orbState.trailDirty) {
      const trail = orbState.trailPositions;
      const count = trail.length;
      const verts = new Float32Array(count * 4 * 7); // center xyz, offset xy, size, alpha
      const indices = new Uint16Array(count * 6);
      let vi = 0;
      let ii = 0;
      for (let i = 0; i < count; i++) {
        const p = trail[i];
        const t = i / (count - 1 || 1); // 0 = oldest (tail), 1 = newest (head)
        // Sharper taper and brighter, fuller head
        const alpha = Math.pow(t, 0.45) * 0.9 * (orbState.alphaScale ?? 1);
        const size = orbState.size * (0.14 + 0.95 * t); // thinner ribbon, distinct from orb
        const offsets = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        for (const o of offsets) {
          verts[vi++] = p[0];
          verts[vi++] = p[1];
          verts[vi++] = p[2];
          verts[vi++] = o[0];
          verts[vi++] = o[1];
          verts[vi++] = size;
          verts[vi++] = alpha;
        }
        const base = i * 4;
        indices[ii++] = base + 0;
        indices[ii++] = base + 1;
        indices[ii++] = base + 2;
        indices[ii++] = base + 0;
        indices[ii++] = base + 2;
        indices[ii++] = base + 3;
      }
      orbState.trailIndexCount = indices.length;
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
      orbState.trailDirty = false;
    }

    gl.enableVertexAttribArray(orbTrailSpriteProgram.aCenter);
    gl.vertexAttribPointer(orbTrailSpriteProgram.aCenter, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(orbTrailSpriteProgram.aOffset);
    gl.vertexAttribPointer(orbTrailSpriteProgram.aOffset, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(orbTrailSpriteProgram.aSize);
    gl.vertexAttribPointer(orbTrailSpriteProgram.aSize, 1, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(orbTrailSpriteProgram.aAlpha);
    gl.vertexAttribPointer(orbTrailSpriteProgram.aAlpha, 1, gl.FLOAT, false, stride, 24);

    const count = orbState.trailIndexCount || orbTrailVertexCount;
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
  }
}

function createOrbProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, ORB_VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, ORB_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Orb program link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    aOffset: gl.getAttribLocation(program, "aOffset"),
    uCenter: gl.getUniformLocation(program, "uCenter"),
    uView: gl.getUniformLocation(program, "uView"),
    uProjection: gl.getUniformLocation(program, "uProjection"),
    uRight: gl.getUniformLocation(program, "uRight"),
    uUp: gl.getUniformLocation(program, "uUp"),
    uSize: gl.getUniformLocation(program, "uSize"),
    uColor: gl.getUniformLocation(program, "uColor"),
  };
}

function createOrbTrailProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, ORB_TRAIL_VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, ORB_TRAIL_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Orb trail program link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    aPosition: gl.getAttribLocation(program, "aPosition"),
    aAlpha: gl.getAttribLocation(program, "aAlpha"),
    uView: gl.getUniformLocation(program, "uView"),
    uProjection: gl.getUniformLocation(program, "uProjection"),
    uColor: gl.getUniformLocation(program, "uColor"),
  };
}

function createOrbTrailSpriteProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, ORB_TRAIL_SPRITE_VERTEX_SOURCE);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, ORB_TRAIL_SPRITE_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Orb trail sprite program link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return {
    program,
    aCenter: gl.getAttribLocation(program, "aCenter"),
    aOffset: gl.getAttribLocation(program, "aOffset"),
    aSize: gl.getAttribLocation(program, "aSize"),
    aAlpha: gl.getAttribLocation(program, "aAlpha"),
    uView: gl.getUniformLocation(program, "uView"),
    uProjection: gl.getUniformLocation(program, "uProjection"),
    uRight: gl.getUniformLocation(program, "uRight"),
    uUp: gl.getUniformLocation(program, "uUp"),
    uColor: gl.getUniformLocation(program, "uColor"),
  };
}
