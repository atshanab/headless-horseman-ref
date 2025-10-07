// Headless Horseman v2 – iOS-safe capture (no createImageBitmap)
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const photoBtn  = document.getElementById('photoBtn');
const flipCam   = document.getElementById('flipCam');
const headScale = document.getElementById('headScale');
const headX     = document.getElementById('headX');
const headY     = document.getElementById('headY');
const hideHead  = document.getElementById('hideHead');
const toast     = document.getElementById('toast');

let currentFacingMode = 'user';
let camera = null;
let cachedHeadCanvas = null; // store as <canvas>
let lastLandmarks = null;

const bg = new Image();
bg.src = 'assets/horseman_bg.png';

function showToast() {
  toast.hidden = false;
  setTimeout(() => toast.hidden = true, 900);
}

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resizeCanvas, {passive:true});

function coverParams() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = canvas.width, ch = canvas.height;
  const vAspect = vw / vh, cAspect = cw / ch;
  let renderW, renderH, offsetX, offsetY;
  if (vAspect > cAspect) { renderH = ch; renderW = ch * vAspect; offsetX = (cw - renderW) / 2; offsetY = 0; }
  else { renderW = cw; renderH = cw / vAspect; offsetX = 0; offsetY = (ch - renderH) / 2; }
  return {vw, vh, cw, ch, renderW, renderH, offsetX, offsetY};
}
function normToCanvas(x, y) {
  const p = coverParams();
  return [x * p.renderW + p.offsetX, y * p.renderH + p.offsetY];
}

function onResults(results) {
  resizeCanvas();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  lastLandmarks = (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) || null;

  const p = coverParams();
  ctx.drawImage(video, p.offsetX, p.offsetY, p.renderW, p.renderH);

  if (hideHead.checked && lastLandmarks) {
    const [xFore,yFore] = normToCanvas(lastLandmarks[10].x, lastLandmarks[10].y);
    const [xChin,yChin] = normToCanvas(lastLandmarks[152].x, lastLandmarks[152].y);
    const [xL,yL] = normToCanvas(lastLandmarks[234].x, lastLandmarks[234].y);
    const [xR,yR] = normToCanvas(lastLandmarks[454].x, lastLandmarks[454].y);
    const faceW = Math.hypot(xR-xL, yR-yL);
    const cx = (xFore + xChin) / 2;
    const cy = (yFore + yChin) / 2 - faceW*0.00; // slightly lower mask to keep neck
    const rx = faceW * 0.62; // larger crop
    const ry = (yChin - yFore) * 0.78;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  if (bg.complete) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);

  if (cachedHeadCanvas) {
    const scale = parseInt(headScale.value, 10) / 100;
    const dx = parseInt(headX.value, 10);
    const dy = parseInt(headY.value, 10);
    const ax = (window.DEFAULT_ANCHOR?.x || 260) + dx;
    const ay = (window.DEFAULT_ANCHOR?.y || 650) + dy;
    const headW = cachedHeadCanvas.width * scale;
    const headH = cachedHeadCanvas.height * scale;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-0.05);
    ctx.drawImage(cachedHeadCanvas, -headW/2, -headH/2, headW, headH);
    ctx.restore();
  }
}

async function start() {
  const faceMesh = new FaceMesh({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  faceMesh.onResults(onResults);

  if (camera) camera.stop();
  camera = new Camera(video, { onFrame: async () => { await faceMesh.send({ image: video }); }, width:1280, height:720, facingMode: currentFacingMode });
  await camera.start();
  resizeCanvas();
}
startBtn.addEventListener('click', () => start());
flipCam.addEventListener('change', () => { currentFacingMode = flipCam.checked ? 'environment' : 'user'; start(); });

// Capture head into an in-memory <canvas> (iOS-safe)
captureBtn.addEventListener('click', () => {
  if (!lastLandmarks) return;
  const p = coverParams();

  const off = document.createElement('canvas');
  off.width = p.cw; off.height = p.ch;
  const octx = off.getContext('2d');
  octx.drawImage(video, p.offsetX, p.offsetY, p.renderW, p.renderH);

  const [xFore,yFore] = normToCanvas(lastLandmarks[10].x, lastLandmarks[10].y);
  const [xChin,yChin] = normToCanvas(lastLandmarks[152].x, lastLandmarks[152].y);
  const [xL,yL] = normToCanvas(lastLandmarks[234].x, lastLandmarks[234].y);
  const [xR,yR] = normToCanvas(lastLandmarks[454].x, lastLandmarks[454].y);
  const faceW = Math.hypot(xR-xL, yR-yL);
  const cx = (xFore + xChin) / 2;
  const cy = (yFore + yChin) / 2 - faceW*0.00;
  const rx = faceW * 0.62;
  const ry = (yChin - yFore) * 0.78;

  const mask = document.createElement('canvas');
  mask.width = off.width; mask.height = off.height;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#000'; mctx.fillRect(0,0,mask.width,mask.height);
  mctx.globalCompositeOperation = 'destination-out';
  mctx.beginPath(); mctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); mctx.fill();

  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);

  // crop tight
  const cropX = Math.max(0, cx - rx - 20), cropY = Math.max(0, cy - ry - 20);
  const cropW = Math.min(off.width - cropX, rx*2 + 40);
  const cropH = Math.min(off.height - cropY, ry*2 + 40);
  const headCanvas = document.createElement('canvas');
  headCanvas.width = cropW; headCanvas.height = cropH;
  headCanvas.getContext('2d').drawImage(off, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  cachedHeadCanvas = headCanvas;
  showToast();
});

// Save final image
photoBtn.addEventListener('click', async () => {
  try {
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const octx = out.getContext('2d');
    octx.drawImage(canvas, 0, 0);
    const blob = await new Promise(res => out.toBlob(res, 'image/png'));
    const file = new File([blob], 'headless_horseman.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Headless Horseman', text: 'Spooky snapshot' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'headless_horseman.png';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      alert('Photo saved/downloaded. On iOS, long-press to Save Image if prompted.');
    }
  } catch (e) {
    console.error(e);
    alert('Could not save photo. Please try again.');
  }
});

document.addEventListener('DOMContentLoaded', () => { start().catch(()=>{}); });
