// main.js
import { initWebGL } from "./webgl-init.js";
import {
  initScene,
  updateScene,
  renderScene,
  getCameraState,
  setCameraState,
  getOrbCount,
  setOrbCount,
} from "./scene.js";

let gl;
let lastTime = 0;
let uiRefs = null;

function main() {
  const canvas = document.getElementById("glCanvas");
  gl = initWebGL(canvas);

  if (!gl) {
    alert("Unable to initialize WebGL.");
    return;
  }

  initScene(gl);
  setupUI();
  requestAnimationFrame(loop);
}

function loop(time) {
  const deltaTime = (time - lastTime) / 1000.0;
  lastTime = time;

  updateScene(gl, deltaTime);
  renderScene(gl);
  syncUI();

  requestAnimationFrame(loop);
}

window.addEventListener("load", main);

function setupUI() {
  const theta = document.getElementById("theta");
  const phi = document.getElementById("phi");
  const zoom = document.getElementById("zoom");
  const spriteCount = document.getElementById("spriteCount");
  const thetaVal = document.getElementById("thetaVal");
  const phiVal = document.getElementById("phiVal");
  const zoomVal = document.getElementById("zoomVal");

  if (!theta || !phi || !zoom || !spriteCount) return;

  const applyCameraFromInputs = () => {
    setCameraState({
      theta: parseFloat(theta.value),
      phi: parseFloat(phi.value),
      radius: parseFloat(zoom.value),
    });
  };

  theta.addEventListener("input", applyCameraFromInputs);
  phi.addEventListener("input", applyCameraFromInputs);
  zoom.addEventListener("input", applyCameraFromInputs);

  spriteCount.addEventListener("change", () => {
    const n = parseInt(spriteCount.value, 10);
    setOrbCount(Number.isFinite(n) ? n : 1);
  });

  setOrbCount(parseInt(spriteCount.value, 10) || getOrbCount());

  uiRefs = { theta, phi, zoom, spriteCount, thetaVal, phiVal, zoomVal };
  syncUI();
}

function syncUI() {
  if (!uiRefs) return;
  const cam = getCameraState();
  const deg = (r) => Math.round((r * 180) / Math.PI);
  uiRefs.theta.value = cam.theta;
  uiRefs.phi.value = cam.phi;
  uiRefs.zoom.value = cam.radius;
  if (uiRefs.thetaVal) uiRefs.thetaVal.textContent = `${deg(cam.theta)}°`;
  if (uiRefs.phiVal) uiRefs.phiVal.textContent = `${deg(cam.phi)}°`;
  if (uiRefs.zoomVal) uiRefs.zoomVal.textContent = cam.radius.toFixed(2);
}
