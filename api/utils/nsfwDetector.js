const nsfw = require("nsfwjs");
let tf;
let backend = "tfjs-node";
try {
  tf = require("@tensorflow/tfjs-node");
  console.log("[NSFW] Using TensorFlow backend: tfjs-node (native)");
} catch (e) {
  console.log("[NSFW] tfjs-node not available (" + (e && e.message ? e.message : e) + "). Falling back to tfjs + wasm backend...");
  tf = require("@tensorflow/tfjs");
  try {
    require("@tensorflow/tfjs-backend-wasm");
    backend = "wasm";
    tf.setBackend("wasm");
  } catch (e2) {
    console.log("[NSFW] Failed to load tfjs-backend-wasm (" + (e2 && e2.message ? e2.message : e2) + "). Falling back to cpu backend.");
    backend = "cpu";
    tf.setBackend("cpu");
  }
}
const { createCanvas, loadImage } = require("canvas");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const os = require("os");
const path = require("path");

let modelPromise = null;
async function loadModelOnce() {
  if (!modelPromise) {
    try {
      await tf.ready();
      console.log("[NSFW] TensorFlow backend ready: " + (tf.getBackend ? tf.getBackend() : backend));
    } catch {}
    modelPromise = nsfw.load();
  }
  return modelPromise;
}

async function classifyImageFile(filePath) {
  const model = await loadModelOnce();
  const image = await loadImage(filePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const predictions = await model.classify(canvas);
  const nsfwScore = predictions
    .filter((p) => ["Porn", "Sexy", "Hentai"].includes(p.className))
    .reduce((sum, p) => sum + p.probability, 0);
  return nsfwScore;
}

async function classifyVideoFile(videoPath, fps = 0.5) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nsfw-frames-"));
  const pattern = path.join(tmpDir, "frame-%06d.jpg");
  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([`-vf fps=${fps}`])
      .output(pattern)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
  const files = fs.readdirSync(tmpDir).map((f) => path.join(tmpDir, f));
  if (files.length === 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return 0;
  }
  let total = 0;
  for (const file of files) {
    const score = await classifyImageFile(file);
    total += score;
    try { fs.unlinkSync(file); } catch {}
  }
  try { fs.rmdirSync(tmpDir); } catch {}
  return total / files.length;
}

function isImageExt(ext) { return [".jpg",".jpeg",".png",".gif",".bmp",".webp"].includes(ext); }
function isVideoExt(ext) { return [".mp4",".mov",".avi",".mkv",".webm"].includes(ext); }

async function checkTelegramMessageMedia(TGbot, msg, threshold = 0.7) {
  // Determine fileId and an extension hint
  let fileId = null;
  let ext = ".jpg";
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const best = msg.photo[msg.photo.length - 1];
    fileId = best.file_id;
    ext = ".jpg";
  } else if (msg.video) {
    fileId = msg.video.file_id;
    const mime = msg.video.mime_type || "";
    if (mime.includes("webm")) ext = ".webm"; else ext = ".mp4";
  } else if (msg.animation) {
    fileId = msg.animation.file_id;
    const mime = msg.animation.mime_type || "";
    if (mime.includes("webp")) ext = ".webp"; else if (mime.includes("mp4")) ext = ".mp4"; else ext = ".mp4";
  } else if (msg.document && msg.document.mime_type) {
    // Handle images/videos sent as documents
    const mime = msg.document.mime_type.toLowerCase();
    fileId = msg.document.file_id;
    if (mime.startsWith("image/")) {
      ext = ".jpg";
    } else if (mime.startsWith("video/")) {
      if (mime.includes("webm")) ext = ".webm"; else if (mime.includes("mp4")) ext = ".mp4"; else ext = ".mp4";
    } else {
      return { checked: false, score: 0, isNSFW: false };
    }
  } else {
    return { checked: false, score: 0, isNSFW: false };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nsfw-tg-"));
  const localPath = path.join(tmpDir, `media${ext}`);
  let savedPath = null;
  try {
    // downloadFile returns full path of saved file
    savedPath = await TGbot.downloadFile(fileId, tmpDir);
  } catch (e) {
    const msgText = (e && e.message) ? e.message.toLowerCase() : String(e).toLowerCase();
    // If Telegram refuses due to size, try thumbnail fallback
    if (msgText.includes('file is too big') || msgText.includes('too big')) {
      console.log('[NSFW] Telegram refused media download: file is too big; falling back to thumbnail classification');
      const thumbId = (msg.video && msg.video.thumbnail && msg.video.thumbnail.file_id) ? msg.video.thumbnail.file_id :
                      (msg.animation && msg.animation.thumbnail && msg.animation.thumbnail.file_id) ? msg.animation.thumbnail.file_id : null;
      if (thumbId) {
        try {
          const thumbPath = await TGbot.downloadFile(thumbId, tmpDir);
          const score = await classifyImageFile(thumbPath);
          const isNSFW = score >= threshold;
          return { checked: true, score, isNSFW };
        } catch (e2) {
          // Fallthrough to finally cleanup then rethrow
          throw e;
        }
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }
  try {
    let score = 0;
    const extName = path.extname(savedPath).toLowerCase();
    if (isImageExt(extName)) {
      score = await classifyImageFile(savedPath);
    } else {
      try {
        score = await classifyVideoFile(savedPath);
      } catch (e) {
        const msgText = (e && e.message) ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msgText.includes('ffmpeg')) {
          console.log('[NSFW] ffmpeg not available; falling back to thumbnail classification');
          // Try to fallback to telegram-provided thumbnail
          const thumbId = (msg.video && msg.video.thumbnail && msg.video.thumbnail.file_id) ? msg.video.thumbnail.file_id :
                          (msg.animation && msg.animation.thumbnail && msg.animation.thumbnail.file_id) ? msg.animation.thumbnail.file_id : null;
          if (thumbId) {
            try {
              const thumbPath = await TGbot.downloadFile(thumbId, tmpDir);
              score = await classifyImageFile(thumbPath);
            } catch (e2) {
              throw e; // rethrow original if thumb path fails too
            }
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }
    const isNSFW = score >= threshold;
    return { checked: true, score, isNSFW };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = {
  checkTelegramMessageMedia,
};
