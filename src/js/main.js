// main.js
import { initWebGL } from "./webgl-init.js";
import { initScene, updateScene, renderScene } from "./scene.js";

let gl;
let lastTime = 0;

function main() {
  const canvas = document.getElementById("glCanvas");
  gl = initWebGL(canvas);

  if (!gl) {
    alert("Unable to initialize WebGL.");
    return;
  }

  initScene(gl);
  requestAnimationFrame(loop);
}

function loop(time) {
  const deltaTime = (time - lastTime) / 1000.0;
  lastTime = time;

  updateScene(gl, deltaTime);
  renderScene(gl);

  requestAnimationFrame(loop);
}

window.addEventListener("load", main);
