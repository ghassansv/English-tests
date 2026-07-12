const SELFIE_SEGMENTATION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";
const SELFIE_SEGMENTATION_ASSET_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/";
const EFFECT_MAX_WIDTH = 640;
const EFFECT_MAX_HEIGHT = 360;
const EFFECT_TARGET_FPS = 15;
const EFFECT_FRAME_INTERVAL_MS = 1000 / EFFECT_TARGET_FPS;

let selfieSegmentationScriptPromise = null;

export async function createBackgroundEffectStream(sourceStream, { mode, backgroundImage, onError } = {}) {
  if (mode === "none") {
    return { stream: sourceStream, dispose() {} };
  }
  if (mode === "image" && !backgroundImage) {
    throw new Error("Choose a background image first");
  }

  const sourceVideo = await sourceVideoFromStream(sourceStream);
  const { width, height } = scaledCanvasSize(sourceVideo.videoWidth || 1280, sourceVideo.videoHeight || 720);
  const canvas = document.createElement("canvas");
  const personCanvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  personCanvas.width = width;
  personCanvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  const personContext = personCanvas.getContext("2d");
  const segmenter = await createSelfieSegmenter();
  let active = true;

  segmenter.onResults(results => {
    drawBackgroundEffectFrame({
      results,
      mode,
      backgroundImage,
      canvas,
      context,
      personCanvas,
      personContext
    });
  });

  let lastFrameAt = 0;
  const loop = async now => {
    if (!active) return;
    if (sourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastFrameAt >= EFFECT_FRAME_INTERVAL_MS) {
      lastFrameAt = now;
      try {
        await segmenter.send({ image: sourceVideo });
      } catch {
        active = false;
        onError?.("Background effect stopped");
        return;
      }
    }
    if (active) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const processedStream = canvas.captureStream(EFFECT_TARGET_FPS);
  sourceStream.getAudioTracks().forEach(track => processedStream.addTrack(track));

  return {
    stream: processedStream,
    dispose() {
      active = false;
      sourceVideo.pause();
      sourceVideo.srcObject = null;
      segmenter.close?.();
    }
  };
}

function sourceVideoFromStream(stream) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", () => {
      video.play().then(() => resolve(video)).catch(reject);
    }, { once: true });
    video.addEventListener("error", () => reject(new Error("Camera preview could not start")), { once: true });
  });
}

async function createSelfieSegmenter() {
  await loadSelfieSegmentationScript();
  if (!window.SelfieSegmentation) {
    throw new Error("Background effects could not load");
  }
  const segmenter = new window.SelfieSegmentation({
    locateFile: file => `${SELFIE_SEGMENTATION_ASSET_BASE}${file}`
  });
  segmenter.setOptions({
    modelSelection: 0,
    selfieMode: true
  });
  return segmenter;
}

function scaledCanvasSize(width, height) {
  const scale = Math.min(1, EFFECT_MAX_WIDTH / width, EFFECT_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function loadSelfieSegmentationScript() {
  if (window.SelfieSegmentation) return Promise.resolve();
  if (!selfieSegmentationScriptPromise) {
    selfieSegmentationScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SELFIE_SEGMENTATION_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Background effects could not load"));
      document.head.appendChild(script);
    });
  }
  return selfieSegmentationScriptPromise;
}

function drawBackgroundEffectFrame({ results, mode, backgroundImage, canvas, context, personCanvas, personContext }) {
  const width = canvas.width;
  const height = canvas.height;

  context.clearRect(0, 0, width, height);
  if (mode === "image" && backgroundImage) {
    drawCover(context, backgroundImage, 0, 0, width, height);
  } else {
    context.save();
    context.filter = "blur(18px)";
    drawCover(context, results.image, -18, -18, width + 36, height + 36);
    context.restore();
  }

  personContext.clearRect(0, 0, width, height);
  personContext.globalCompositeOperation = "source-over";
  personContext.drawImage(results.segmentationMask, 0, 0, width, height);
  personContext.globalCompositeOperation = "source-in";
  personContext.drawImage(results.image, 0, 0, width, height);
  personContext.globalCompositeOperation = "source-over";

  context.drawImage(personCanvas, 0, 0, width, height);
}

function drawCover(context, image, x, y, width, height) {
  const sourceWidth = image.videoWidth || image.naturalWidth || image.width || width;
  const sourceHeight = image.videoHeight || image.naturalHeight || image.height || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}
