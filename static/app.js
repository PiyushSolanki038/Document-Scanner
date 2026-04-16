/**
 * app.js -- Frontend logic for DocScan Pro.
 * Handles file upload (drag-and-drop + click), API calls, result display,
 * debug mode toggle, download, and error handling.
 */

(function () {
    "use strict";

    // ----------------------------------------------------------
    // API Config
    // ----------------------------------------------------------
    const API_BASE = window.location.origin;
    const SCAN_URL = `${API_BASE}/scan`;
    const SCAN_DEBUG_URL = `${API_BASE}/scan-debug`;

    // ----------------------------------------------------------
    // DOM Elements
    // ----------------------------------------------------------
    const uploadSection   = document.getElementById("upload-section");
    const previewSection  = document.getElementById("preview-section");
    const loadingSection  = document.getElementById("loading-section");
    const errorSection    = document.getElementById("error-section");
    const resultSection   = document.getElementById("result-section");
    const debugSection    = document.getElementById("debug-section");

    const uploadZone      = document.getElementById("upload-zone");
    const fileInput       = document.getElementById("file-input");
    const previewImage    = document.getElementById("preview-image");
    const fileName        = document.getElementById("file-name");
    const fileSize        = document.getElementById("file-size");

    const scanBtn         = document.getElementById("scan-btn");
    const clearBtn        = document.getElementById("clear-btn");
    const retryBtn        = document.getElementById("retry-btn");
    const newScanBtn      = document.getElementById("new-scan-btn");
    const downloadBtn     = document.getElementById("download-btn");

    const debugToggle     = document.getElementById("debug-toggle");
    const debugGrid       = document.getElementById("debug-grid");

    const resultOriginal  = document.getElementById("result-original");
    const resultScanned   = document.getElementById("result-scanned");
    const errorMessage    = document.getElementById("error-message");

    // ----------------------------------------------------------
    // State
    // ----------------------------------------------------------
    let currentFile = null;
    let scannedBase64 = null;

    // ----------------------------------------------------------
    // Utility
    // ----------------------------------------------------------
    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / 1048576).toFixed(1) + " MB";
    }

    function showSection(section) {
        [uploadSection, previewSection, loadingSection, errorSection, resultSection, debugSection]
            .forEach(s => s.classList.add("hidden"));
        if (Array.isArray(section)) {
            section.forEach(s => s.classList.remove("hidden"));
        } else {
            section.classList.remove("hidden");
        }
    }

    // ----------------------------------------------------------
    // Upload Handling
    // ----------------------------------------------------------
    uploadZone.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    });

    // Drag & Drop
    uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.classList.add("drag-over");
    });

    uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("drag-over");
    });

    uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.classList.remove("drag-over");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    function handleFile(file) {
        const validTypes = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/tiff"];
        if (!validTypes.some(t => file.type.startsWith(t.split("/")[0]))) {
            showError("Please upload a valid image file (PNG, JPG, WEBP, BMP, TIFF).");
            return;
        }

        currentFile = file;
        scannedBase64 = null;

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImage.src = e.target.result;
            fileName.textContent = file.name;
            fileSize.textContent = formatBytes(file.size);
            showSection(previewSection);
        };
        reader.readAsDataURL(file);
    }

    // ----------------------------------------------------------
    // Clear / Retry / New Scan
    // ----------------------------------------------------------
    clearBtn.addEventListener("click", resetToUpload);
    retryBtn.addEventListener("click", resetToUpload);
    newScanBtn.addEventListener("click", resetToUpload);

    function resetToUpload() {
        currentFile = null;
        scannedBase64 = null;
        fileInput.value = "";
        previewImage.src = "";
        resultOriginal.src = "";
        resultScanned.src = "";
        debugGrid.innerHTML = "";
        showSection(uploadSection);
    }

    // ----------------------------------------------------------
    // Scan
    // ----------------------------------------------------------
    scanBtn.addEventListener("click", startScan);

    async function startScan() {
        if (!currentFile) return;

        const isDebug = debugToggle.checked;
        const url = isDebug ? SCAN_DEBUG_URL : SCAN_URL;

        showSection(loadingSection);

        try {
            const formData = new FormData();
            formData.append("image", currentFile);

            const response = await fetch(url, {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                showError(data.error || "Something went wrong.");
                return;
            }

            if (isDebug) {
                displayDebugResult(data);
            } else {
                displayResult(data);
            }
        } catch (err) {
            console.error("Scan error:", err);
            showError("Network error. Is the server running?");
        }
    }

    // ----------------------------------------------------------
    // Display Results
    // ----------------------------------------------------------
    function displayResult(data) {
        scannedBase64 = data.scanned;

        // Set original preview
        const reader = new FileReader();
        reader.onload = (e) => {
            resultOriginal.src = e.target.result;
        };
        reader.readAsDataURL(currentFile);

        // Set scanned result
        resultScanned.src = `data:image/png;base64,${scannedBase64}`;

        showSection(resultSection);
    }

    function displayDebugResult(data) {
        const steps = data.steps;
        scannedBase64 = steps.scanned;

        // Set the main comparison view
        const reader = new FileReader();
        reader.onload = (e) => {
            resultOriginal.src = e.target.result;
        };
        reader.readAsDataURL(currentFile);
        resultScanned.src = `data:image/png;base64,${scannedBase64}`;

        // Build debug grid
        const labels = {
            original:  { name: "Original Image",       num: 1 },
            grayscale: { name: "Grayscale",             num: 2 },
            blurred:   { name: "Gaussian Blur",         num: 3 },
            edges:     { name: "Canny Edge Detection",  num: 4 },
            contour:   { name: "Detected Contour",      num: 5 },
            warped:    { name: "Perspective Transform",  num: 6 },
            scanned:   { name: "Final Scanned Output",  num: 7 },
        };

        debugGrid.innerHTML = "";

        for (const [key, meta] of Object.entries(labels)) {
            if (!steps[key]) continue;

            const card = document.createElement("div");
            card.className = "debug-card";

            card.innerHTML = `
                <div class="debug-card-label">
                    <span class="step-num">${meta.num}</span>
                    ${meta.name}
                </div>
                <div class="debug-card-image">
                    <img src="data:image/png;base64,${steps[key]}" alt="${meta.name}">
                </div>
            `;

            debugGrid.appendChild(card);
        }

        showSection([resultSection, debugSection]);
    }

    // ----------------------------------------------------------
    // Error Display
    // ----------------------------------------------------------
    function showError(message) {
        errorMessage.textContent = message;
        showSection(errorSection);
    }

    // ----------------------------------------------------------
    // Download PNG
    // ----------------------------------------------------------
    downloadBtn.addEventListener("click", () => {
        // Support both upload scan and camera scan
        const b64 = scannedBase64 || window.__cameraScannedB64;
        if (!b64) return;

        const link = document.createElement("a");
        link.href = `data:image/png;base64,${b64}`;

        const baseName = currentFile
            ? currentFile.name.replace(/\.[^.]+$/, "")
            : "camera_document";
        link.download = `${baseName}_scanned.png`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // ----------------------------------------------------------
    // Download PDF
    // ----------------------------------------------------------
    const downloadPdfBtn = document.getElementById("download-pdf-btn");
    downloadPdfBtn.addEventListener("click", () => {
        const b64 = scannedBase64 || window.__cameraScannedB64;
        if (!b64) return;

        const baseName = currentFile
            ? currentFile.name.replace(/\.[^.]+$/, "")
            : "camera_document";

        // Create an image to get dimensions
        const img = new Image();
        img.onload = () => {
            // Hardened check for jsPDF global
            let jsPDFClass = null;
            if (window.jspdf && window.jspdf.jsPDF) {
                jsPDFClass = window.jspdf.jsPDF;
            } else if (window.jsPDF) {
                jsPDFClass = window.jsPDF;
            }

            if (!jsPDFClass) {
                console.error("jsPDF library not found in window");
                alert("PDF library failed to load. Please refresh the page while connected to the internet.");
                return;
            }

            // Determine orientation based on image aspect ratio
            const isLandscape = img.width > img.height;
            const orientation = isLandscape ? "landscape" : "portrait";
            const pdf = new jsPDFClass({ orientation, unit: "mm", format: "a4" });

            // Get page dimensions
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 10; // mm

            // Fit image within page with margin
            const maxW = pageW - margin * 2;
            const maxH = pageH - margin * 2;
            const ratio = Math.min(maxW / img.width, maxH / img.height);
            const imgW = img.width * ratio;
            const imgH = img.height * ratio;

            // Center on page
            const x = (pageW - imgW) / 2;
            const y = (pageH - imgH) / 2;

            pdf.addImage(`data:image/png;base64,${b64}`, "PNG", x, y, imgW, imgH);
            pdf.save(`${baseName}_scanned.pdf`);
        };
        img.src = `data:image/png;base64,${b64}`;
    });

    // ----------------------------------------------------------
    // Lightbox (Hover-to-View / Click-to-Enlarge)
    // ----------------------------------------------------------
    const lightboxOverlay = document.getElementById("lightbox-overlay");
    const lightboxImage   = document.getElementById("lightbox-image");
    const lightboxLabel   = document.getElementById("lightbox-label");
    const lightboxClose   = document.getElementById("lightbox-close");
    const lightboxBackdrop = lightboxOverlay.querySelector(".lightbox-backdrop");

    function openLightbox(imgSrc, label) {
        lightboxImage.src = imgSrc;
        lightboxLabel.textContent = label || "Image Preview";
        lightboxOverlay.classList.add("active");
        document.body.classList.add("lightbox-open");
    }

    function closeLightbox() {
        lightboxOverlay.classList.remove("active");
        document.body.classList.remove("lightbox-open");
        // Clear image after animation
        setTimeout(() => {
            if (!lightboxOverlay.classList.contains("active")) {
                lightboxImage.src = "";
            }
        }, 300);
    }

    // Close handlers
    lightboxClose.addEventListener("click", closeLightbox);
    lightboxBackdrop.addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lightboxOverlay.classList.contains("active")) {
            closeLightbox();
        }
    });

    /**
     * Add a "Click to view" zoom hint badge to an image container.
     */
    function addZoomHint(container) {
        if (container.querySelector(".zoom-hint")) return; // already has one
        const hint = document.createElement("span");
        hint.className = "zoom-hint";
        hint.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Click to view`;
        container.appendChild(hint);
    }

    /**
     * Make all images inside zoomable containers clickable to open lightbox.
     * Uses event delegation on the body.
     */
    document.body.addEventListener("click", (e) => {
        const img = e.target.closest(".comparison-image-wrap img, .debug-card-image img, .preview-image-wrap img");
        if (!img) return;

        // Determine label from context
        let label = "Image Preview";
        const card = img.closest(".comparison-card, .debug-card, .preview-card");
        if (card) {
            const labelEl = card.querySelector(".comparison-label, .debug-card-label, .file-info span");
            if (labelEl) label = labelEl.textContent.trim();
        }

        openLightbox(img.src, label);
    });

    /**
     * Observe DOM for new images (debug cards added dynamically)
     * and inject zoom hints automatically.
     */
    function injectZoomHints() {
        document.querySelectorAll(".comparison-image-wrap, .debug-card-image, .preview-image-wrap").forEach(addZoomHint);
    }

    // Inject on page load
    injectZoomHints();

    // Re-inject when debug grid or results change
    const observer = new MutationObserver(() => {
        injectZoomHints();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();

