/* script.js - Jewels-Ai Atelier: Drive Integration + WhatsApp Lead Gen + Actual Filenames */

/* --- CONFIGURATION --- */
const API_KEY = "AIzaSyBhi05HMVGg90dPP91zG1RZtNxm-d6hnQw"; 

// YOUR DEPLOYED GOOGLE APPS SCRIPT URL (Lead Gen)
const UPLOAD_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyPHfmUs74hhB4zL1y77xTrKccvE3-PZ-yBzTQe2w8GXSsah5Sz_PyLvCYhLnVpVDyw3w/exec";

const DRIVE_FOLDERS = {
  diamond_earrings: "1N0jndAEIThUuuNAJpvuRMGsisIaXCgMZ",
  diamond_necklaces: "1JGV8T03YdzjfW0Dyt9aMPybH8V9-gEhw",
  gold_earrings: "1GMZpcv4A1Gy2xiaIC1XPG_IOAt9NrDpi",
  gold_necklaces: "1QIvX-PrSVrK9gz-TEksqiKlXPGv2hsS5"
};

/* Asset Cache */
const JEWELRY_ASSETS = {};
const PRELOADED_IMAGES = {}; 

/* --- 1. PRELOAD WATERMARK --- */
const watermarkImg = new Image();
watermarkImg.src = 'logo_watermark.png'; 

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const loadingStatus = document.getElementById('loading-status');

/* Hide Gesture Indicator */
const gestureIndicator = document.getElementById('gesture-indicator');
if (gestureIndicator) gestureIndicator.style.display = 'none';
const indicatorDot = document.getElementById('indicator-dot');

/* App State */
let earringImg = null, necklaceImg = null, currentType = '';
let isProcessingHand = false, isProcessingFace = false;
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; 
let previousHandX = null;     

/* Try All / Gallery State */
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;
let currentPreviewData = { url: null, name: 'Jewels-Ai_look.png' }; 

/* WhatsApp Modal State */
let pendingDownloadAction = null; // 'single' or 'zip'

/* --- GOOGLE DRIVE IMAGE FETCHING --- */
async function fetchFromDrive(category) {
    if (JEWELRY_ASSETS[category]) return;

    const folderId = DRIVE_FOLDERS[category];
    if (!folderId) return;

    loadingStatus.style.display = 'block';
    loadingStatus.textContent = "Fetching Designs...";

    try {
        const query = `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,thumbnailLink)&key=${API_KEY}`;
        
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) throw new Error(data.error.message);

        JEWELRY_ASSETS[category] = data.files.map(file => {
            // High-Res Thumbnail Hack (=s3000)
            const highResSource = file.thumbnailLink 
                ? file.thumbnailLink.replace(/=s\d+$/, "=s3000") 
                : `https://drive.google.com/uc?export=view&id=${file.id}`;

            return { id: file.id, name: file.name, src: highResSource };
        });
        loadingStatus.style.display = 'none';
    } catch (err) {
        console.error("Drive API Error:", err);
        loadingStatus.textContent = "Error Loading Images";
        alert("Failed to load images. Check console.");
    }
}

/* --- PRELOADER --- */
async function preloadCategory(type) {
    await fetchFromDrive(type);
    if (!JEWELRY_ASSETS[type]) return;

    if (!PRELOADED_IMAGES[type]) {
        PRELOADED_IMAGES[type] = [];
        const files = JEWELRY_ASSETS[type];
        const promises = files.map(file => {
            return new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous'; 
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null); 
                img.src = file.src;
                PRELOADED_IMAGES[type].push(img);
            });
        });
        loadingStatus.style.display = 'block';
        loadingStatus.textContent = "Downloading Assets...";
        await Promise.all(promises);
        loadingStatus.style.display = 'none';
    }
}

/* --- WHATSAPP LEAD GEN LOGIC --- */
// 
function requestWhatsApp(actionType) {
    pendingDownloadAction = actionType;
    document.getElementById('whatsapp-modal').style.display = 'flex';
}

function closeWhatsAppModal() {
    document.getElementById('whatsapp-modal').style.display = 'none';
    pendingDownloadAction = null;
}

function confirmWhatsAppDownload() {
    const phoneInput = document.getElementById('user-phone');
    const phone = phoneInput.value.trim();

    if (phone.length < 5) { // Basic validation
        alert("Please enter a valid WhatsApp number.");
        return;
    }

    // 1. UI Feedback
    document.getElementById('whatsapp-modal').style.display = 'none';
    const overlay = document.getElementById('process-overlay');
    const spinner = document.getElementById('process-spinner');
    const text = document.getElementById('process-text');
    
    overlay.style.display = 'flex';
    spinner.style.display = 'block';
    text.innerText = "Processing Download...";

    // 2. Upload to Drive (Fire and forget)
    uploadToDrive(phone);

    // 3. Start Download for User
    setTimeout(() => {
        if (pendingDownloadAction === 'single') {
            performSingleDownload();
        } else if (pendingDownloadAction === 'zip') {
            performZipDownload();
        }
        
        // Hide spinner shortly after download starts
        setTimeout(() => { overlay.style.display = 'none'; }, 2500);
    }, 1500);
}

function uploadToDrive(phone) {
    if (pendingDownloadAction === 'single') {
        sendDataToScript(phone, currentPreviewData.url, currentPreviewData.name);
    } 
    else if (pendingDownloadAction === 'zip') {
        // Upload all snapshots currently in the gallery
        autoSnapshots.forEach((item) => {
            sendDataToScript(phone, item.url, item.name);
        });
    }
}

function sendDataToScript(phone, base64Data, filename) {
    // We use no-cors because Google Scripts don't support CORS headers perfectly for simple POSTs
    fetch(UPLOAD_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            phone: phone,
            image: base64Data,
            filename: filename
        })
    }).then(() => console.log(`Sent ${filename} to Drive`))
      .catch(err => console.error("Upload failed", err));
}

/* --- DOWNLOAD FUNCTIONS --- */
function downloadSingleSnapshot() {
    if(currentPreviewData && currentPreviewData.url) {
        requestWhatsApp('single'); // Trigger Modal
    }
}

function downloadAllAsZip() {
    if (autoSnapshots.length === 0) {
        alert("No images to download!");
        return;
    }
    requestWhatsApp('zip'); // Trigger Modal
}

function performSingleDownload() {
    saveAs(currentPreviewData.url, currentPreviewData.name);
}

function performZipDownload() {
    const zip = new JSZip();
    const folder = zip.folder("Jewels-Ai_Collection"); // BRANDING UPDATED

    autoSnapshots.forEach((item) => {
        const base64Data = item.url.replace(/^data:image\/(png|jpg);base64,/, "");
        folder.file(item.name, base64Data, {base64: true});
    });

    zip.generateAsync({type:"blob"}).then(function(content) {
        saveAs(content, "Jewels-Ai_Collection.zip"); // BRANDING UPDATED
    });
}

/* --- SHARE FUNCTION --- */
async function shareSingleSnapshot() {
    if(!currentPreviewData.url) return;
    const response = await fetch(currentPreviewData.url);
    const blob = await response.blob();
    const file = new File([blob], currentPreviewData.name, { type: "image/png" });
    
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'My Jewels-Ai Look', // BRANDING UPDATED
                text: 'Check out this jewelry I tried on virtually!',
                files: [file]
            });
        } catch (err) { console.warn("Share failed:", err); }
    } else {
        alert("Sharing not supported. Please Download.");
    }
}

/* --- CORE APP LOGIC (CAMERA & AI) --- */
function updateHandIndicator(detected) { if (!detected) previousHandX = null; }

function flashIndicator(color) {
    if(indicatorDot && indicatorDot.style.display !== 'none') {
        indicatorDot.style.background = color;
        setTimeout(() => { indicatorDot.style.background = "#00ff88"; }, 300);
    }
}

const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
hands.onResults((results) => {
  isProcessingHand = false; 
  const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  updateHandIndicator(hasHand);

  if (!hasHand || autoTryRunning) return;
  const now = Date.now();
  if (now - lastGestureTime < GESTURE_COOLDOWN) return;
  const landmarks = results.multiHandLandmarks[0];
  const indexTip = landmarks[8]; 
  const currentX = indexTip.x;   

  if (previousHandX !== null) {
      const diff = currentX - previousHandX;
      if (diff < -0.04) { navigateJewelry(1); lastGestureTime = now; flashIndicator("#d4af37"); previousHandX = null; } 
      else if (diff > 0.04) { navigateJewelry(-1); lastGestureTime = now; flashIndicator("#d4af37"); previousHandX = null; }
  }
  if (now - lastGestureTime > 100) previousHandX = currentX;
});

const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
faceMesh.onResults((results) => {
  isProcessingFace = false;
  if(loadingStatus.style.display !== 'none' && loadingStatus.textContent === "Loading AI Models...") loadingStatus.style.display = 'none';

  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
  
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.translate(canvasElement.width, 0);
  canvasCtx.scale(-1, 1);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0];
    const leftEar = { x: lm[132].x * canvasElement.width, y: lm[132].y * canvasElement.height };
    const rightEar = { x: lm[361].x * canvasElement.width, y: lm[361].y * canvasElement.height };
    const neck = { x: lm[152].x * canvasElement.width, y: lm[152].y * canvasElement.height };
    const earDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);

    if (earringImg && earringImg.complete) {
      let ew = earDist * 0.25;
      let eh = (earringImg.height/earringImg.width) * ew;
      canvasCtx.drawImage(earringImg, leftEar.x - ew/2, leftEar.y, ew, eh);
      canvasCtx.drawImage(earringImg, rightEar.x - ew/2, rightEar.y, ew, eh);
    }
    if (necklaceImg && necklaceImg.complete) {
      let nw = earDist * 1.2;
      let nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (earDist*0.2), nw, nh);
    }
  }
  canvasCtx.restore();
});

async function startCameraFast() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
        videoElement.srcObject = stream;
        videoElement.onloadeddata = () => { videoElement.play(); loadingStatus.textContent = "Loading AI Models..."; detectLoop(); };
    } catch (err) { alert("Camera permission denied."); loadingStatus.textContent = "Camera Error"; }
}
async function detectLoop() {
    if (videoElement.readyState >= 2) {
        if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); }
        if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); }
    }
    requestAnimationFrame(detectLoop);
}
window.onload = startCameraFast;

/* --- UI HELPERS --- */
function navigateJewelry(dir) {
  if (!currentType || !PRELOADED_IMAGES[currentType]) return;
  const list = PRELOADED_IMAGES[currentType];
  let currentImg = currentType.includes('earrings') ? earringImg : necklaceImg;
  let idx = list.indexOf(currentImg);
  if (idx === -1) idx = 0; 
  let nextIdx = (idx + dir + list.length) % list.length;
  const nextItem = list[nextIdx];
  if (currentType.includes('earrings')) earringImg = nextItem; else necklaceImg = nextItem;
}

async function selectJewelryType(type) {
  currentType = type;
  await preloadCategory(type); 
  const container = document.getElementById('jewelry-options');
  container.innerHTML = ''; container.style.display = 'flex';
  const files = JEWELRY_ASSETS[type];
  if (!files) return;
  files.forEach((file, i) => {
    const btnImg = new Image(); btnImg.src = file.src; btnImg.crossOrigin = 'anonymous'; btnImg.className = "thumb-btn"; 
    btnImg.onclick = () => {
        const fullImg = PRELOADED_IMAGES[type][i];
        if (type.includes('earrings')) earringImg = fullImg; else necklaceImg = fullImg;
    };
    container.appendChild(btnImg);
  });
}
function toggleCategory(cat) {
  document.getElementById('subcategory-buttons').style.display = 'flex';
  const subs = document.querySelectorAll('.subpill');
  subs.forEach(b => b.style.display = b.innerText.toLowerCase().includes(cat) ? 'inline-block' : 'none');
}
async function toggleTryAll() {
  if (!currentType) { alert("Select a sub-category first!"); return; }
  if (autoTryRunning) stopAutoTry(); else startAutoTry();
}
function startAutoTry() {
  autoTryRunning = true; autoSnapshots = []; autoTryIndex = 0;
  const btn = document.getElementById('tryall-btn'); btn.textContent = "STOPPING..."; btn.classList.add('active');
  runAutoStep();
}
function stopAutoTry() {
  autoTryRunning = false; if (autoTryTimeout) clearTimeout(autoTryTimeout);
  const btn = document.getElementById('tryall-btn'); btn.textContent = "Try All"; btn.classList.remove('active');
  if (autoSnapshots.length > 0) showGallery();
}
async function runAutoStep() {
  if (!autoTryRunning) return;
  const assets = PRELOADED_IMAGES[currentType];
  if (!assets || autoTryIndex >= assets.length) { stopAutoTry(); return; }
  const targetImg = assets[autoTryIndex];
  if (currentType.includes('earrings')) earringImg = targetImg; else necklaceImg = targetImg;
  autoTryTimeout = setTimeout(() => { captureToGallery(); autoTryIndex++; runAutoStep(); }, 1500); 
}

/* --- CAPTURE LOGIC (BRANDING UPDATED) --- */
function captureToGallery() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = videoElement.videoWidth; tempCanvas.height = videoElement.videoHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.translate(tempCanvas.width, 0); tempCtx.scale(-1, 1); tempCtx.drawImage(videoElement, 0, 0);
  tempCtx.setTransform(1, 0, 0, 1, 0, 0); 
  try { tempCtx.drawImage(canvasElement, 0, 0); } catch(e) {}

  let itemName = "Jewels-Ai Look"; let itemFilename = "Jewels-Ai_look.png"; // BRANDING UPDATED
  if (currentType && PRELOADED_IMAGES[currentType]) {
      const list = PRELOADED_IMAGES[currentType];
      let currentImg = currentType.includes('earrings') ? earringImg : necklaceImg;
      let idx = list.indexOf(currentImg);
      if(idx >= 0 && JEWELRY_ASSETS[currentType][idx]) {
          const rawFilename = JEWELRY_ASSETS[currentType][idx].name;
          const nameOnly = rawFilename.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
          itemName = nameOnly.replace(/\b\w/g, l => l.toUpperCase());
          itemFilename = rawFilename.replace(/\.[^/.]+$/, "") + ".png";
      }
  }
  const padding = 20; 
  tempCtx.font = "bold 24px Montserrat, sans-serif"; tempCtx.textAlign = "left"; tempCtx.textBaseline = "bottom";
  tempCtx.fillStyle = "rgba(0,0,0,0.8)"; tempCtx.fillText(itemName, padding + 2, tempCanvas.height - padding + 2);
  tempCtx.fillStyle = "#ffffff"; tempCtx.fillText(itemName, padding, tempCanvas.height - padding);
  if (watermarkImg.complete && watermarkImg.naturalWidth > 0) {
      const wWidth = tempCanvas.width * 0.25; const wHeight = (watermarkImg.height / watermarkImg.width) * wWidth;
      tempCtx.drawImage(watermarkImg, tempCanvas.width - wWidth - padding, tempCanvas.height - wHeight - padding, wWidth, wHeight);
  }
  const dataUrl = tempCanvas.toDataURL('image/png');
  autoSnapshots.push({ url: dataUrl, name: itemFilename });
  const flash = document.getElementById('flash-overlay');
  if(flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 100); }
  return { url: dataUrl, name: itemFilename }; 
}
function takeSnapshot() { const shotData = captureToGallery(); openSinglePreview(shotData); }
function openSinglePreview(shotData) { currentPreviewData = shotData; document.getElementById('preview-image').src = shotData.url; document.getElementById('preview-modal').style.display = 'flex'; }
function closePreview() { document.getElementById('preview-modal').style.display = 'none'; }

/* --- GALLERY HELPERS --- */
function showGallery() {
  const modal = document.getElementById('gallery-modal'); const grid = document.getElementById('gallery-grid');
  if(!modal || !grid) return;
  grid.innerHTML = '';
  autoSnapshots.forEach((item, index) => {
    const wrapper = document.createElement('div'); wrapper.className = "gallery-item-wrapper";
    const img = document.createElement('img'); img.src = item.url; img.className = "gallery-thumb";
    img.onclick = () => openLightbox(index);
    wrapper.appendChild(img); grid.appendChild(wrapper);
  });
  modal.style.display = 'flex';
}
function openLightbox(selectedIndex) {
    const lightbox = document.getElementById('lightbox-overlay');
    document.getElementById('lightbox-image').src = autoSnapshots[selectedIndex].url;
    const strip = document.getElementById('lightbox-thumbs'); strip.innerHTML = '';
    autoSnapshots.forEach((item, idx) => {
        const thumb = document.createElement('img'); thumb.src = item.url; thumb.className = "strip-thumb";
        if(idx === selectedIndex) thumb.classList.add('active');
        thumb.onclick = () => {
            document.getElementById('lightbox-image').src = item.url;
            document.querySelectorAll('.strip-thumb').forEach(t => t.classList.remove('active')); thumb.classList.add('active');
        };
        strip.appendChild(thumb);
    });
    lightbox.style.display = 'flex';
}
function closeLightbox() { document.getElementById('lightbox-overlay').style.display = 'none'; }
function closeGallery() { document.getElementById('gallery-modal').style.display = 'none'; }

/* --- GLOBAL INIT --- */
window.toggleCategory = toggleCategory; window.selectJewelryType = selectJewelryType; window.toggleTryAll = toggleTryAll;
window.closeGallery = closeGallery; window.closeLightbox = closeLightbox; window.takeSnapshot = takeSnapshot;
window.downloadAllAsZip = downloadAllAsZip; window.closePreview = closePreview;
window.downloadSingleSnapshot = downloadSingleSnapshot; window.shareSingleSnapshot = shareSingleSnapshot;
window.confirmWhatsAppDownload = confirmWhatsAppDownload; window.closeWhatsAppModal = closeWhatsAppModal;

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.onkeydown = function(e) { if (e.keyCode === 123) return false; };