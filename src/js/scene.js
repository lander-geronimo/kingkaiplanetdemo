// scene.js
// Planet geometry + shaders for King Kai's planet branch.

const { mat4 } = window.glMatrix;
// Helpers for procedural meshes
import { buildBox, latheProfile, buildTriangleStripIndices } from "./geo-helpers.js";

// Module-level state for the planet and its shader program
let planet = null;
let planetProgram = null;
let house = null;
let trees = [];

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

export function initScene(gl) {
  console.log("Scene initialized");

  // Rendering setup
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.frontFace(gl.CCW);
  gl.cullFace(gl.BACK);

  // Deep space-like clear color, slight purple/blue tint
  gl.clearColor(0.02, 0.0, 0.08, 1.0);

  setupOrbitControls(gl.canvas);
  initPlanet(gl);
  initHouse(gl);
  initTrees(gl);
}

export function updateScene(gl, dt) {
  resizeViewportIfNeeded(gl);
  updateCameraMatrices(gl);
  spinPlanet(dt);
}

export function renderScene(gl) {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  drawPlanet(gl, camera.view, camera.projection);
  drawHouse(gl, camera.view, camera.projection);
  drawTrees(gl, camera.view, camera.projection);
}

// Exported so the camera branch can call it directly if desired.
export function drawPlanet(gl, view, projection) {
  if (!planet || !planetProgram) return;

  gl.useProgram(planetProgram);

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
  // Dome: true hemisphere
  const hemiRadius = 0.6;
  const domeGeom = createHemisphere(hemiRadius, 24, 32);
  const domeMesh = createMesh(gl, domeGeom);

  // Door: rectangular box, protruding outward
  const doorDims = { w: 0.18, h: 0.24, d: 0.08 };
  const doorGeom = buildBox(doorDims);
  const doorMesh = createMesh(gl, doorGeom);

  // Placement: scale and sink so base sits flush; door pushed outward
  const scale = 0.38;
  const modelMatrix = buildSurfaceTransformScaled(
    1.0,
    Math.PI * 0.18,
    Math.PI * 0.3,
    hemiRadius,
    scale,
    0,
    -0.45
  );

  house = {
    parts: [
      { mesh: domeMesh, color: [1.0, 0.92, 0.55], modelOffset: [0, 0, 0] },
      { mesh: doorMesh, color: [1.0, 1.0, 1.0], modelOffset: [0, doorDims.h * 0.5, hemiRadius + doorDims.d * 0.25] },
    ],
    baseModel: modelMatrix,
  };
}

function initTrees(gl) {
  trees = [];
  const trunkHeight = 0.35;
  const trunkRadius = 0.06;
  const foliageRadius = 0.18;

  const trunkGeom = createCylinder(trunkRadius, trunkRadius, trunkHeight, 12);
  const trunkMesh = createMesh(gl, trunkGeom);

  const foliageGeom = createSphere(foliageRadius, 12, 16);
  const foliageMesh = createMesh(gl, foliageGeom);

  // A few sample trees around the house
  const placements = [
    { lat: Math.PI * 0.20, lon: Math.PI * 0.32 },
    { lat: Math.PI * 0.16, lon: Math.PI * 0.28 },
    { lat: Math.PI * 0.22, lon: Math.PI * 0.26 },
  ];

  const scale = 0.6;
  placements.forEach((p) => {
    const model = buildSurfaceTransformScaled(1.0, p.lat, p.lon, trunkHeight + foliageRadius, scale, 0, -0.1);
    trees.push({
      model,
      parts: [
        { mesh: trunkMesh, color: [0.55, 0.35, 0.2], offset: [0, trunkHeight * 0.5, 0] },
        { mesh: foliageMesh, color: [0.1, 0.6, 0.1], offset: [0, trunkHeight + foliageRadius * 0.6, 0] },
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
