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
  getOrbiters,
  setOrbChaser,
} from "./scene.js";

let gl;
let lastTime = 0;
let uiRefs = null;
let lastOrbList = [];

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
  const orbSelect = document.getElementById("orbSelect");
  const chaserToggle = document.getElementById("chaserToggle");
  const thetaVal = document.getElementById("thetaVal");
  const phiVal = document.getElementById("phiVal");
  const zoomVal = document.getElementById("zoomVal");

  if (!theta || !phi || !zoom || !spriteCount || !orbSelect || !chaserToggle) return;

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
    rebuildOrbSelect(orbSelect);
  });

  setOrbCount(parseInt(spriteCount.value, 10) || getOrbCount());

  orbSelect.addEventListener("change", () => {
    syncOrbSelection(orbSelect, chaserToggle);
  });
  chaserToggle.addEventListener("change", () => {
    const id = parseInt(orbSelect.value, 10);
    if (!Number.isFinite(id)) return;
    setOrbChaser(id, chaserToggle.checked);
  });

  uiRefs = { theta, phi, zoom, spriteCount, thetaVal, phiVal, zoomVal, orbSelect, chaserToggle };
  rebuildOrbSelect(orbSelect);
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
  rebuildOrbSelect(uiRefs.orbSelect);
  syncOrbSelection(uiRefs.orbSelect, uiRefs.chaserToggle);
}

function rebuildOrbSelect(selectEl) {
  if (!selectEl) return;
  const orbs = getOrbiters();
  if (orbs.length === lastOrbList.length && orbs.every((o, i) => o.id === lastOrbList[i]?.id)) {
    return; // no change
  }
  lastOrbList = orbs;
  const prev = parseInt(selectEl.value, 10);
  selectEl.innerHTML = "";
  orbs.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.name;
    selectEl.appendChild(opt);
  });
  const first = orbs.find((o) => o.id === prev) ? prev : orbs[0]?.id;
  if (first !== undefined) selectEl.value = first;
}

function syncOrbSelection(selectEl, toggleEl) {
  if (!selectEl || !toggleEl) return;
  const id = parseInt(selectEl.value, 10);
  const orb = getOrbiters().find((o) => o.id === id);
  if (!orb) return;
  toggleEl.checked = !!orb.isChaser;
}
