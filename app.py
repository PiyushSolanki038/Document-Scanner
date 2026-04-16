"""
app.py -- Flask server for the Web Document Scanner.
Endpoints:
    GET  /            -> Serves the frontend (static/index.html)
    POST /scan        -> Accepts image, returns scanned result as base64 PNG
    POST /scan-debug  -> Accepts image, returns all pipeline steps as base64 PNGs
    POST /detect      -> Accepts base64 frame, returns detected corner points (fast)
    POST /scan-frame  -> Accepts base64 frame, returns scanned image as base64 PNG
"""

import base64
import traceback

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from scanner import scan_document, scan_document_debug, detect_only

app = Flask(__name__, static_folder="static", static_url_path="/static")
CORS(app)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp", "tiff", "tif"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def encode_image_to_base64(image: np.ndarray) -> str:
    """Encode a numpy image (BGR or grayscale) to a base64 PNG string."""
    success, buffer = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("Failed to encode image to PNG.")
    return base64.b64encode(buffer).decode("utf-8")


# ----------------------------------------------------------
# Routes
# ----------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/sw.js")
def service_worker():
    """Serve service worker from root for proper PWA scope."""
    return send_from_directory("static", "sw.js", mimetype="application/javascript")


@app.route("/scan", methods=["POST"])
def scan():
    """Scan an uploaded image and return the result as base64 PNG."""
    if "image" not in request.files:
        return jsonify({"error": "No image file uploaded. Use form field 'image'."}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    if not allowed_file(file.filename):
        return jsonify({
            "error": f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        }), 400

    try:
        file_bytes = file.read()
        if len(file_bytes) > MAX_FILE_SIZE:
            return jsonify({"error": "File too large. Maximum size is 20 MB."}), 400

        scanned = scan_document(file_bytes)
        result_b64 = encode_image_to_base64(scanned)
        return jsonify({"success": True, "scanned": result_b64}), 200

    except RuntimeError as e:
        return jsonify({"error": str(e)}), 422
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


@app.route("/scan-debug", methods=["POST"])
def scan_debug():
    """Scan with debug mode -- returns all intermediate pipeline images."""
    if "image" not in request.files:
        return jsonify({"error": "No image file uploaded. Use form field 'image'."}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    if not allowed_file(file.filename):
        return jsonify({
            "error": f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        }), 400

    try:
        file_bytes = file.read()
        if len(file_bytes) > MAX_FILE_SIZE:
            return jsonify({"error": "File too large. Maximum size is 20 MB."}), 400

        steps = scan_document_debug(file_bytes)
        result = {"success": True, "steps": {}}
        for name, img in steps.items():
            result["steps"][name] = encode_image_to_base64(img)
        return jsonify(result), 200

    except RuntimeError as e:
        return jsonify({"error": str(e)}), 422
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500


@app.route("/detect", methods=["POST"])
def detect():
    """
    Fast detection endpoint for real-time camera overlay.
    Accepts JSON: { "frame": "base64-encoded-jpeg" }
    Returns: { "detected": true/false, "points": [[x,y],...] }
    """
    try:
        data = request.get_json(force=True)
        if not data or "frame" not in data:
            return jsonify({"detected": False, "error": "No frame data."}), 400

        frame_data = data["frame"]

        # Strip data URL prefix if present
        if "," in frame_data:
            frame_data = frame_data.split(",", 1)[1]

        frame_bytes = base64.b64decode(frame_data)
        points = detect_only(frame_bytes)

        if points is not None:
            return jsonify({"detected": True, "points": points}), 200
        else:
            return jsonify({"detected": False}), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({"detected": False, "error": str(e)}), 200


@app.route("/scan-frame", methods=["POST"])
def scan_frame():
    """
    Scan a camera-captured frame (sent as base64 JSON).
    Returns the scanned image as base64 PNG.
    """
    try:
        data = request.get_json(force=True)
        if not data or "frame" not in data:
            return jsonify({"error": "No frame data."}), 400

        frame_data = data["frame"]
        if "," in frame_data:
            frame_data = frame_data.split(",", 1)[1]

        frame_bytes = base64.b64decode(frame_data)
        scanned = scan_document(frame_bytes)
        result_b64 = encode_image_to_base64(scanned)
        return jsonify({"success": True, "scanned": result_b64}), 200

    except RuntimeError as e:
        return jsonify({"error": str(e)}), 422
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Server error: {str(e)}"}), 500


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"
    
    print("=" * 50)
    print(f"  Document Scanner Web App starting on port {port}")
    print("=" * 50)
    app.run(debug=debug, host="0.0.0.0", port=port)
