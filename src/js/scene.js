// scene.js
// Planet geometry + shaders for King Kai's planet branch.

const { mat4 } = window.glMatrix;

// Module-level state for the planet and its shader program
let planet = null;
let planetProgram = null;

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

  // Deep space-like clear color, slight purple/blue tint
  gl.clearColor(0.02, 0.0, 0.08, 1.0);

  setupOrbitControls(gl.canvas);
  initPlanet(gl);
}

export function updateScene(gl, dt) {
  updateCameraMatrices(gl);
  // Physics / movement / gravity will go here later.
}

export function renderScene(gl) {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  drawPlanet(gl, camera.view, camera.projection);
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
