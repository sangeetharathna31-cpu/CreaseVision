/* TEST DOUBLE for @vladmandic/face-api. The real neural nets cannot be downloaded in the sandbox, so this derives a
 * deterministic 128-number "descriptor" from the image pixels (16x8 luma grid). Everything in the APP (distance maths,
 * threshold, confidence formula, gallery, storage, history, UI) is the real code. */
(function () {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const dims = (s) => ({ w: s.naturalWidth || s.videoWidth || s.width, h: s.naturalHeight || s.videoHeight || s.height });
  function grid(src, sx, sy, sw, sh) {
    sw = Math.round(sw); sh = Math.round(sh);
    const c = document.createElement("canvas"); c.width = sw; c.height = sh;
    const x = c.getContext("2d"); x.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh); // 1:1 copy, no resampling
    const out = new Float32Array(128);
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 16; gx++)
      out[gy * 16 + gx] = (x.getImageData(Math.floor((gx + 0.5) * sw / 16), Math.floor((gy + 0.5) * sh / 8), 1, 1).data[0] / 255) * 0.2;
    return out;
  }
  function faces(src) {
    const { w, h } = dims(src);
    const t = document.createElement("canvas"); t.width = 1; t.height = 1;
    const tx = t.getContext("2d"); tx.drawImage(src, 0, 0, 1, 1, 0, 0, 1, 1);
    const px = tx.getImageData(0, 0, 1, 1).data;
    if (px[0] > 250 && px[1] > 250 && px[2] > 250) return []; // white corner pixel = "no face in this picture"
    const score = px[0] > 250 && px[1] < 5 ? 0.55 : 0.96; // red corner pixel = a face the detector is unsure about
    if (w > 800) return [0, 1].map((i) => ({ detection: { box: { x: w / 2 * i + w * 0.1, y: h * 0.15, width: w * 0.3, height: h * 0.55 }, score: 0.97 - i * 0.02 }, descriptor: grid(src, w / 2 * i, 0, w / 2, h) }));
    return [{ detection: { box: { x: w * 0.3, y: h * 0.15, width: w * 0.4, height: h * 0.55 }, score }, descriptor: grid(src, 0, 0, w, h) }];
  }
  const net = { loadFromUri: async () => { await delay(500); } };
  window.__faceapiCalls = 0;
  window.faceapi = {
    nets: { ssdMobilenetv1: net, faceLandmark68Net: net, faceRecognitionNet: net },
    SsdMobilenetv1Options: class { constructor(o) { this.o = o; } },
    fetchImage: (u) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = u; }),
    detectSingleFace(src) { window.__faceapiCalls++; const f = faces(src)[0];
      return { withFaceLandmarks: () => ({ withFaceDescriptor: async () => { await delay(5); return f; } }) }; },
    detectAllFaces(src) { window.__faceapiCalls++; const f = faces(src);
      return { withFaceLandmarks: () => ({ withFaceDescriptors: async () => { await delay(250); return f; } }) }; },
  };
})();
