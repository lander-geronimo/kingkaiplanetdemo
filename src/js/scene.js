// scene.js
export function initScene(gl) {
    console.log("Scene initialized");
    // Later:
    // - load shaders
    // - create sphere for King Kai’s planet
    // - camera setup
  }
  
  export function updateScene(gl, dt) {
    // TODO:
    // - physics
    // - movement
    // - gravity toward planet center
  }
  
  export function renderScene(gl) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // TODO:
    // - draw planet
    // - draw character
  }
  