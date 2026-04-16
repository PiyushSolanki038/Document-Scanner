"""
scanner.py -- Core OpenCV scanning pipeline for the Web Document Scanner.
All CV constants are named at the top for easy tuning.
Returns numpy arrays; encoding to base64 is handled by app.py.
"""

import cv2
import numpy as np

# ----------------------------------------------------------
# Tunable Constants
# ----------------------------------------------------------

MAX_WIDTH = 800

BLUR_KERNEL_SIZE = (5, 5)
BLUR_SIGMA = 0

CANNY_THRESHOLDS = [
    (75, 200),
    (50, 150),
    (30, 100),
]

TOP_N_CONTOURS = 10
CONTOUR_APPROX_EPSILON_RATIO = 0.02

# Minimum contour area as a fraction of the total image area.
# Contours smaller than this are rejected (avoids grabbing tiny boxes).
MIN_CONTOUR_AREA_RATIO = 0.15

MORPH_KERNEL_SIZE = (5, 5)
MORPH_ITERATIONS = 2

ADAPTIVE_THRESH_BLOCK_SIZE = 11
ADAPTIVE_THRESH_C = 10


# ----------------------------------------------------------
# Helper Functions
# ----------------------------------------------------------

def resize_image(image: np.ndarray, max_width: int = MAX_WIDTH) -> np.ndarray:
    """Resize proportionally if wider than max_width."""
    h, w = image.shape[:2]
    if w <= max_width:
        return image
    ratio = max_width / float(w)
    return cv2.resize(image, (max_width, int(h * ratio)), interpolation=cv2.INTER_AREA)


def order_points(pts: np.ndarray) -> np.ndarray:
    """
    Order 4 corner points: TL, TR, BR, BL using sum/diff method.
    - TL = smallest sum (x+y)
    - BR = largest sum (x+y)
    - TR = smallest diff (y-x)
    - BL = largest diff (y-x)
    """
    pts = pts.reshape(4, 2).astype(np.float32)
    ordered = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).flatten()
    ordered[0] = pts[np.argmin(s)]   # TL
    ordered[2] = pts[np.argmax(s)]   # BR
    ordered[1] = pts[np.argmin(d)]   # TR
    ordered[3] = pts[np.argmax(d)]   # BL
    return ordered


def get_full_image_contour(image: np.ndarray) -> np.ndarray:
    """Return a contour that covers the entire image (fallback)."""
    h, w = image.shape[:2]
    return np.array([
        [[0, 0]],
        [[w - 1, 0]],
        [[w - 1, h - 1]],
        [[0, h - 1]]
    ], dtype=np.int32)


# ----------------------------------------------------------
# Pipeline Steps (each returns intermediate results)
# ----------------------------------------------------------

def step_load(file_bytes: bytes) -> np.ndarray:
    """Decode uploaded file bytes into a resized BGR image."""
    arr = np.frombuffer(file_bytes, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode the uploaded image.")
    return resize_image(image)


def step_grayscale(image: np.ndarray) -> np.ndarray:
    """Convert BGR to grayscale."""
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def step_blur(gray: np.ndarray) -> np.ndarray:
    """Apply Gaussian blur."""
    return cv2.GaussianBlur(gray, BLUR_KERNEL_SIZE, BLUR_SIGMA)


def step_edges(blurred: np.ndarray, low: int, high: int) -> np.ndarray:
    """Apply Canny edge detection + morphological closing."""
    edged = cv2.Canny(blurred, low, high)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_KERNEL_SIZE)
    edged = cv2.dilate(edged, kernel, iterations=MORPH_ITERATIONS)
    edged = cv2.erode(edged, kernel, iterations=1)
    return edged


def step_find_contour(edged: np.ndarray, image_area: int) -> np.ndarray:
    """
    Find the largest 4-corner contour that covers at least
    MIN_CONTOUR_AREA_RATIO of the image. Returns None if not found.
    """
    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    min_area = image_area * MIN_CONTOUR_AREA_RATIO
    contours = sorted(contours, key=cv2.contourArea, reverse=True)

    for c in contours[:TOP_N_CONTOURS]:
        area = cv2.contourArea(c)
        if area < min_area:
            continue  # Too small -- skip this contour
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, CONTOUR_APPROX_EPSILON_RATIO * peri, True)
        if len(approx) == 4:
            return approx

    return None


def step_find_contour_robust(image: np.ndarray) -> tuple:
    """
    Try multiple strategies to find the document contour.
    Returns (contour, edges_used, used_fallback).

    If no large enough 4-corner contour is found, falls back to
    the full image boundary so the scan effect still works.
    """
    h, w = image.shape[:2]
    image_area = h * w
    gray = step_grayscale(image)
    blurred = step_blur(gray)

    # Strategy 1: Multiple Canny thresholds
    for low, high in CANNY_THRESHOLDS:
        edged = step_edges(blurred, low, high)
        contour = step_find_contour(edged, image_area)
        if contour is not None:
            return contour, edged, False

    # Strategy 2: Adaptive threshold then Canny
    thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY, 11, 2)
    edged = cv2.Canny(thresh, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_KERNEL_SIZE)
    edged = cv2.dilate(edged, kernel, iterations=MORPH_ITERATIONS)
    contour = step_find_contour(edged, image_area)
    if contour is not None:
        return contour, edged, False

    # Strategy 3: Otsu threshold then Canny
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edged = cv2.Canny(otsu, 50, 150)
    edged = cv2.dilate(edged, kernel, iterations=MORPH_ITERATIONS)
    contour = step_find_contour(edged, image_area)
    if contour is not None:
        return contour, edged, False

    # Fallback: Use the full image as the document
    # (no perspective correction needed -- just apply scan effect)
    fallback_contour = get_full_image_contour(image)
    return fallback_contour, edged, True


def step_draw_contour(image: np.ndarray, contour: np.ndarray, is_fallback: bool = False) -> np.ndarray:
    """Draw the detected contour on a copy of the image."""
    output = image.copy()
    color = (0, 165, 255) if is_fallback else (0, 255, 0)  # Orange for fallback, green for detected
    cv2.drawContours(output, [contour], -1, color, 3)
    # Draw corner circles
    for point in contour.reshape(-1, 2):
        cv2.circle(output, tuple(point), 8, (0, 0, 255), -1)
    if is_fallback:
        cv2.putText(output, "Full image (no document edge found)",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)
    return output


def step_perspective_transform(image: np.ndarray, contour: np.ndarray) -> np.ndarray:
    """Warp perspective to produce a flat rectangular document."""
    rect = order_points(contour)
    (tl, tr, br, bl) = rect

    width_top = np.linalg.norm(tr - tl)
    width_bottom = np.linalg.norm(br - bl)
    max_w = max(int(width_top), int(width_bottom))

    height_left = np.linalg.norm(bl - tl)
    height_right = np.linalg.norm(br - tr)
    max_h = max(int(height_left), int(height_right))

    dst = np.array([
        [0, 0], [max_w - 1, 0],
        [max_w - 1, max_h - 1], [0, max_h - 1]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (max_w, max_h))


def step_scan_effect(warped: np.ndarray) -> np.ndarray:
    """Apply adaptive threshold for clean B&W scan look."""
    if len(warped.shape) == 3:
        gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    else:
        gray = warped
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, ADAPTIVE_THRESH_BLOCK_SIZE, ADAPTIVE_THRESH_C
    )


# ----------------------------------------------------------
# Full Pipeline
# ----------------------------------------------------------

def scan_document(file_bytes: bytes) -> np.ndarray:
    """
    Run the full scanning pipeline on uploaded file bytes.
    Returns the final scanned B&W image.
    Falls back to full-image scan if no document contour is found.
    """
    image = step_load(file_bytes)
    contour, _, used_fallback = step_find_contour_robust(image)

    if used_fallback:
        # No document edge found -- scan the full image as-is
        scanned = step_scan_effect(image)
    else:
        warped = step_perspective_transform(image, contour)
        scanned = step_scan_effect(warped)

    return scanned


def scan_document_debug(file_bytes: bytes) -> dict:
    """
    Run the full pipeline and return all intermediate images as a dict.
    Keys: original, grayscale, blurred, edges, contour, warped, scanned
    """
    image = step_load(file_bytes)
    gray = step_grayscale(image)
    blurred = step_blur(gray)

    contour, edged, used_fallback = step_find_contour_robust(image)

    contour_img = step_draw_contour(image, contour, is_fallback=used_fallback)

    if used_fallback:
        warped = image.copy()
        scanned = step_scan_effect(image)
    else:
        warped = step_perspective_transform(image, contour)
        scanned = step_scan_effect(warped)

    return {
        "original": image,
        "grayscale": gray,
        "blurred": blurred,
        "edges": edged,
        "contour": contour_img,
        "warped": warped,
        "scanned": scanned,
    }


# ----------------------------------------------------------
# Fast Detection Only (for real-time camera overlay)
# Optimized for speed but robust enough for real-world lighting.
# ----------------------------------------------------------

DETECT_MAX_WIDTH = 400   # Match client-side resize for accuracy
DETECT_MIN_AREA_RATIO = 0.05  # Low threshold to catch papers at any distance

def _find_quad_in_edges(edged, min_area):
    """Find the largest 4-corner contour in an edge map."""
    contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:8]
    for c in contours:
        area = cv2.contourArea(c)
        if area < min_area:
            break
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            return approx
    return None


def detect_only(file_bytes: bytes):
    """
    Ultra-fast but robust detection for real-time camera frames.
    Uses multiple strategies to handle varied lighting.
    Returns ordered corner points scaled to original dimensions, or None.
    """
    arr = np.frombuffer(file_bytes, np.uint8)
    original = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if original is None:
        return None

    orig_h, orig_w = original.shape[:2]

    # Resize for fast processing
    if orig_w > DETECT_MAX_WIDTH:
        ratio = DETECT_MAX_WIDTH / float(orig_w)
        small = cv2.resize(original, (DETECT_MAX_WIDTH, int(orig_h * ratio)),
                           interpolation=cv2.INTER_AREA)
    else:
        ratio = 1.0
        small = original

    h, w = small.shape[:2]
    image_area = h * w
    min_area = image_area * DETECT_MIN_AREA_RATIO

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))

    # Strategy 1: Multiple Canny thresholds
    for low, high in [(50, 150), (30, 100), (75, 200)]:
        edged = cv2.Canny(blurred, low, high)
        edged = cv2.dilate(edged, kernel, iterations=2)
        edged = cv2.erode(edged, kernel, iterations=1)
        approx = _find_quad_in_edges(edged, min_area)
        if approx is not None:
            return _scale_and_return(approx, ratio)

    # Strategy 2: Adaptive threshold (handles uneven lighting)
    thresh = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY, 11, 2)
    edged = cv2.Canny(thresh, 50, 150)
    edged = cv2.dilate(edged, kernel, iterations=2)
    approx = _find_quad_in_edges(edged, min_area)
    if approx is not None:
        return _scale_and_return(approx, ratio)

    # Strategy 3: Otsu threshold (auto-threshold for bimodal images)
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edged = cv2.Canny(otsu, 50, 150)
    edged = cv2.dilate(edged, kernel, iterations=2)
    approx = _find_quad_in_edges(edged, min_area)
    if approx is not None:
        return _scale_and_return(approx, ratio)

    # Strategy 4: Morphological gradient (edge detection via dilation - erosion)
    morph_grad = cv2.morphologyEx(blurred, cv2.MORPH_GRADIENT, kernel)
    _, thresh_grad = cv2.threshold(morph_grad, 30, 255, cv2.THRESH_BINARY)
    thresh_grad = cv2.dilate(thresh_grad, kernel, iterations=1)
    approx = _find_quad_in_edges(thresh_grad, min_area)
    if approx is not None:
        return _scale_and_return(approx, ratio)

    return None


def _scale_and_return(approx, ratio):
    """Scale contour points back to original image dimensions."""
    pts = approx.reshape(4, 2).astype(float)
    if ratio != 1.0:
        pts = pts / ratio
    ordered = order_points(pts)
    return ordered.astype(int).tolist()



