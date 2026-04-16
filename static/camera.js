/**
 * camera.js -- Real-time camera document detection with overlay.
 * Features:
 *   - Live camera stream with rear-camera preference
 *   - Polls /detect every 200ms for document corners
 *   - Draws green quad overlay + red corner dots on canvas
 *   - Stability detection: auto-captures after 10 stable frames
 *   - Manual shutter button
 *   - Sends captured frame to /scan-frame for processing
 */

(function () {
    "use strict";

    // ----------------------------------------------------------
    // Config
    // ----------------------------------------------------------
    const DETECT_URL = window.location.origin + "/detect";
    const SCAN_FRAME_URL = window.location.origin + "/scan-frame";
    const POLL_INTERVAL_MS = 150;         // Faster polling for snappy detection
    const STABILITY_THRESHOLD = 10;       // frames needed for auto-capture
    const POINT_VARIANCE_PX = 20;         // max pixel drift for "stable" (scaled)
    const DETECT_FRAME_WIDTH = 480;       // Bigger frames for real-world accuracy
    const DETECT_JPEG_QUALITY = 0.6;      // Better quality for edge detection
    const CAPTURE_JPEG_QUALITY = 0.92;    // High quality for final capture

    // ----------------------------------------------------------
    // DOM Elements
    // ----------------------------------------------------------
    const openBtn       = document.getElementById("camera-open-btn");
    const overlay       = document.getElementById("camera-overlay");
    const closeBtn      = document.getElementById("camera-close-btn");
    const video         = document.getElementById("camera-video");
    const canvas        = document.getElementById("camera-canvas");
    const ctx           = canvas.getContext("2d");
    const shutterBtn    = document.getElementById("shutter-btn");
    const statusDot     = document.querySelector(".camera-status-dot");
    const statusText    = document.getElementById("camera-status-text");
    const stabilityWrap = document.getElementById("stability-ring-wrap");
    const stabilityRing = document.getElementById("stability-ring-progress");
    const stabilityCount = document.getElementById("stability-count");

    // App.js sections (need access to show results)
    const uploadSection = document.getElementById("upload-section");
    const resultSection = document.getElementById("result-section");
    const resultOriginal = document.getElementById("result-original");
    const resultScanned  = document.getElementById("result-scanned");

    // ----------------------------------------------------------
    // State
    // ----------------------------------------------------------
    let stream = null;
    let pollTimer = null;
    let isPolling = false;
    let lastPoints = null;
    let stableCount = 0;
    let isCapturing = false;

    // Circumference for the SVG stability ring (r=44)
    const RING_CIRCUMFERENCE = 2 * Math.PI * 44;

    // ----------------------------------------------------------
    // Open Camera
    // ----------------------------------------------------------
    openBtn.addEventListener("click", openCamera);

    async function openCamera() {
        try {
            // Try rear camera first, fallback to any camera
            const constraints = {
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                }
            };

            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (e) {
                // Fallback: any camera
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
            }

            video.srcObject = stream;
            await video.play();

            // Show overlay
            overlay.classList.add("active");
            document.body.classList.add("camera-open");

            // Size canvas to match video
            video.addEventListener("loadedmetadata", syncCanvasSize);
            syncCanvasSize();

            // Start polling
            resetStability();
            startPolling();

        } catch (err) {
            console.error("Camera access failed:", err);
            alert("Could not access camera. Please allow camera permission and try again.");
        }
    }

    function syncCanvasSize() {
        const vw = video.videoWidth || video.clientWidth;
        const vh = video.videoHeight || video.clientHeight;
        canvas.width = vw;
        canvas.height = vh;
    }

    // ----------------------------------------------------------
    // Close Camera
    // ----------------------------------------------------------
    closeBtn.addEventListener("click", closeCamera);

    function closeCamera() {
        stopPolling();

        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }

        video.srcObject = null;
        overlay.classList.remove("active");
        document.body.classList.remove("camera-open");

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resetStability();
    }

    // ----------------------------------------------------------
    // Detection Polling
    // ----------------------------------------------------------
    function startPolling() {
        if (isPolling) return;
        isPolling = true;
        poll();
    }

    function stopPolling() {
        isPolling = false;
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    async function poll() {
        if (!isPolling || !stream) return;

        try {
            // Get video dimensions
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;

            // Resize frame to small size for fast detection
            const scale = Math.min(DETECT_FRAME_WIDTH / vw, 1);
            const sendW = Math.round(vw * scale);
            const sendH = Math.round(vh * scale);

            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = sendW;
            tempCanvas.height = sendH;
            const tctx = tempCanvas.getContext("2d");
            tctx.drawImage(video, 0, 0, sendW, sendH);

            const frameDataUrl = tempCanvas.toDataURL("image/jpeg", DETECT_JPEG_QUALITY);

            // Send to /detect
            const res = await fetch(DETECT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ frame: frameDataUrl }),
            });

            const data = await res.json();

            if (data.detected && data.points) {
                // Points are in the small-frame coordinate space.
                // Scale them back to actual video dimensions for overlay.
                const scaleBack = 1 / scale;
                const scaledPts = data.points.map(p => [
                    Math.round(p[0] * scaleBack),
                    Math.round(p[1] * scaleBack),
                ]);
                drawOverlay(scaledPts, true);
                checkStability(scaledPts);
            } else {
                drawOverlay(null, false);
                resetStability();
            }

        } catch (err) {
            // Network error -- skip this frame
            console.warn("Detect poll error:", err);
        }

        // Schedule next poll
        if (isPolling) {
            pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        }
    }

    // ----------------------------------------------------------
    // Canvas Overlay Drawing
    // ----------------------------------------------------------
    function drawOverlay(points, detected) {
        // Sync canvas size
        syncCanvasSize();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (detected && points && points.length === 4) {
            // Scale points: detect_only returns points at original image resolution
            // which matches video resolution since we send the video frame directly
            const pts = points;

            // Semi-transparent green fill
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            ctx.lineTo(pts[1][0], pts[1][1]);
            ctx.lineTo(pts[2][0], pts[2][1]);
            ctx.lineTo(pts[3][0], pts[3][1]);
            ctx.closePath();
            ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
            ctx.fill();

            // Green border
            ctx.strokeStyle = "#00FF00";
            ctx.lineWidth = 3;
            ctx.stroke();

            // Red corner dots
            for (const pt of pts) {
                ctx.beginPath();
                ctx.arc(pt[0], pt[1], 6, 0, Math.PI * 2);
                ctx.fillStyle = "#FF0000";
                ctx.fill();
                ctx.strokeStyle = "#FFFFFF";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Top-left label
            const labelText = `DETECTED CONTOUR`;
            ctx.font = "bold 14px Inter, sans-serif";
            const metrics = ctx.measureText(labelText);
            const lx = 12, ly = 12;
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(lx, ly, metrics.width + 16, 26);
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(labelText, lx + 8, ly + 18);

            // Update status
            setStatus("detected", "Document detected");

        } else {
            // No document -- draw faint red border
            const pad = 30;
            ctx.strokeStyle = "rgba(255, 80, 80, 0.4)";
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 6]);
            ctx.strokeRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
            ctx.setLineDash([]);

            // Label
            ctx.font = "bold 14px Inter, sans-serif";
            ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
            ctx.textAlign = "center";
            ctx.fillText("No document detected", canvas.width / 2, canvas.height / 2);
            ctx.textAlign = "start";

            setStatus("searching", "Searching for document...");
        }
    }

    function setStatus(state, text) {
        statusText.textContent = text;
        statusDot.className = "camera-status-dot";
        if (state === "detected") {
            statusDot.classList.add("status-green");
        } else if (state === "stable") {
            statusDot.classList.add("status-yellow");
        } else if (state === "capturing") {
            statusDot.classList.add("status-blue");
        }
    }

    // ----------------------------------------------------------
    // Stability Detection
    // ----------------------------------------------------------
    function checkStability(points) {
        if (lastPoints && pointsAreStable(lastPoints, points)) {
            stableCount++;
        } else {
            stableCount = 1; // Reset but count this frame
        }

        lastPoints = points;
        updateStabilityUI();

        if (stableCount >= STABILITY_THRESHOLD && !isCapturing) {
            setStatus("capturing", "Auto-capturing...");
            captureAndScan();
        } else if (stableCount >= 3) {
            setStatus("stable", `Hold still... (${stableCount}/${STABILITY_THRESHOLD})`);
        }
    }

    function pointsAreStable(prev, curr) {
        if (!prev || !curr || prev.length !== 4 || curr.length !== 4) return false;
        for (let i = 0; i < 4; i++) {
            const dx = Math.abs(prev[i][0] - curr[i][0]);
            const dy = Math.abs(prev[i][1] - curr[i][1]);
            if (dx > POINT_VARIANCE_PX || dy > POINT_VARIANCE_PX) return false;
        }
        return true;
    }

    function resetStability() {
        stableCount = 0;
        lastPoints = null;
        updateStabilityUI();
    }

    function updateStabilityUI() {
        const pct = Math.min(stableCount / STABILITY_THRESHOLD, 1);
        const offset = RING_CIRCUMFERENCE * (1 - pct);
        stabilityRing.style.strokeDashoffset = offset;
        stabilityCount.textContent = stableCount;

        if (pct >= 1) {
            stabilityWrap.classList.add("complete");
        } else {
            stabilityWrap.classList.remove("complete");
        }
    }

    // ----------------------------------------------------------
    // Capture & Scan
    // ----------------------------------------------------------
    shutterBtn.addEventListener("click", () => {
        if (!isCapturing) captureAndScan();
    });

    async function captureAndScan() {
        if (isCapturing) return;
        isCapturing = true;

        setStatus("capturing", "Scanning...");
        shutterBtn.classList.add("capturing");

        // Stop polling during capture
        stopPolling();

        try {
            // Capture high-res frame
            const captureCanvas = document.createElement("canvas");
            const cw = video.videoWidth;
            const ch = video.videoHeight;
            captureCanvas.width = cw;
            captureCanvas.height = ch;
            const cctx = captureCanvas.getContext("2d");
            cctx.drawImage(video, 0, 0, cw, ch);

            const frameDataUrl = captureCanvas.toDataURL("image/jpeg", 0.92);

            // Flash effect
            overlay.classList.add("flash");
            setTimeout(() => overlay.classList.remove("flash"), 300);

            // Send to /scan-frame
            const res = await fetch(SCAN_FRAME_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ frame: frameDataUrl }),
            });

            const data = await res.json();

            if (data.success && data.scanned) {
                // Close camera and show results
                closeCamera();

                // Set result images
                resultOriginal.src = frameDataUrl;
                resultScanned.src = `data:image/png;base64,${data.scanned}`;

                // Store scanned base64 for download (communicate with app.js)
                window.__cameraScannedB64 = data.scanned;
                window.__cameraFrameDataUrl = frameDataUrl;

                // Show result section, hide upload
                document.querySelectorAll("#upload-section, #preview-section, #loading-section, #error-section, #debug-section")
                    .forEach(s => s.classList.add("hidden"));
                resultSection.classList.remove("hidden");
            } else {
                setStatus("searching", data.error || "Scan failed. Try again.");
                startPolling();
            }
        } catch (err) {
            console.error("Scan error:", err);
            setStatus("searching", "Network error. Retrying...");
            startPolling();
        }

        isCapturing = false;
        shutterBtn.classList.remove("capturing");
    }

})();
