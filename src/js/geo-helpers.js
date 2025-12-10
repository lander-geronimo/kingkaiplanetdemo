// Minimal geometry helpers inspired by Fungi, with simpler names/outputs.

function toTriples(profile) {
  // Accept [[x,y,z], ...] or flat [x,y,z,...]; return flat array.
  if (Array.isArray(profile[0])) {
    const out = [];
    for (const p of profile) out.push(p[0], p[1], p[2] ?? 0);
    return out;
  }
  return profile.slice();
}

// Revolve a 2D-ish profile (xyz) into a lathed surface.
export function latheProfile(profile, steps, axis = "y") {
  const src = toTriples(profile);
  const out = [];
  const inc = (Math.PI * 2) / steps;
  for (let i = 0; i < steps; i++) {
    const rad = -Math.PI / 2 + inc * i; // start at -90deg to center seams
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (let j = 0; j < src.length; j += 3) {
      const x = src[j];
      const y = src[j + 1];
      const z = src[j + 2];
      let rx = x;
      let ry = y;
      let rz = z;
      if (axis === "y") {
        ry = y;
        rx = z * sin + x * cos;
        rz = z * cos - x * sin;
      } else if (axis === "x") {
        rx = x;
        ry = y * cos - z * sin;
        rz = y * sin + z * cos;
      } else {
        rz = z;
        rx = x * cos - y * sin;
        ry = x * sin + y * cos;
      }
      out.push(rx, ry, rz);
    }
  }
  return out;
}

// Build triangle-strip indices for a rows×cols grid (e.g., lathed mesh).
export function buildTriangleStripIndices(rows, cols, loopRows = false, closeCols = false) {
  const ind = [];
  const lastCol = cols - 1;
  const last = cols * (rows - 1) - 1;
  let a = 0;
  let b = cols;
  for (let i = 0; i < (rows - 1) * cols; i++) {
    const c = i % cols;
    ind.push(a + c, b + c);
    const isEnd = c === lastCol;
    if (isEnd) {
      if (i === last && loopRows) {
        if (closeCols) ind.push(a, b);
        ind.push(b + lastCol, b);
        i += cols;
        a += cols;
        b = 0;
      } else if (i >= last && closeCols) {
        ind.push(a, b);
      } else if (i < last) {
        if (closeCols) ind.push(a, b);
        ind.push(b + lastCol, b);
        a += cols;
        b += cols;
      }
    }
  }
  return ind;
}

// Apply a constant offset to all positions.
export function offsetPositions(positions, offset) {
  const [ox, oy, oz] = offset;
  const out = positions.slice();
  for (let i = 0; i < out.length; i += 3) {
    out[i] += ox;
    out[i + 1] += oy;
    out[i + 2] += oz;
  }
  return out;
}

// Centered unit quad.
export function buildQuad() {
  const positions = [-0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0];
  const indices = [0, 1, 2, 2, 3, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  const uvs = [0, 0, 0, 1, 1, 1, 1, 0];
  return { positions, indices, normals, uvs };
}

// Box with per-face normals (good for flat shading).
export function buildBox({ w = 1, h = 1, d = 1 } = {}) {
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  const positions = [
    x0, y1, z1, x0, y0, z1, x1, y0, z1, x1, y1, z1, // front
    x1, y1, z0, x1, y0, z0, x0, y0, z0, x0, y1, z0, // back
    x0, y1, z0, x0, y0, z0, x0, y0, z1, x0, y1, z1, // left
    x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1, // bottom
    x1, y1, z1, x1, y0, z1, x1, y0, z0, x1, y1, z0, // right
    x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, // top
  ];
  const indices = [];
  for (let i = 0; i < 6 * 4; i += 2) indices.push(i, i + 1, Math.floor(i / 4) * 4 + ((i + 2) % 4));
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ];
  return { positions, indices, normals };
}

// Lathe-based sphere; optional if you already have a sphere generator.
export function buildPolarSphere(vertSteps = 10, horSteps = 12, radius = 1) {
  const profile = [];
  const origin = Math.PI * 0.5;
  const inc = Math.PI / (vertSteps - 1);
  for (let i = vertSteps - 1; i >= 0; i--) {
    const rad = origin - inc * i;
    profile.push(radius * Math.cos(rad), radius * Math.sin(rad), 0);
  }
  const positions = latheProfile(profile, horSteps, "y");
  const indices = buildTriangleStripIndices(horSteps, profile.length / 3, true, false);
  const normals = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    normals.push(x / len, y / len, z / len);
  }
  return { positions, indices, normals };
}

