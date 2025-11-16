// webgl-init.js
export function initWebGL(canvas) {
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  
    if (!gl) {
      console.error("WebGL is not supported.");
      return null;
    }
  
    resizeCanvasToDisplaySize(canvas, gl);
    window.addEventListener("resize", () => resizeCanvasToDisplaySize(canvas, gl));
  
    gl.clearColor(0, 0, 0, 1);
    gl.enable(gl.DEPTH_TEST);
  
    return gl;
  }
  
  function resizeCanvasToDisplaySize(canvas, gl) {
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;
  
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
      gl.viewport(0, 0, displayWidth, displayHeight);
    }
  }
  