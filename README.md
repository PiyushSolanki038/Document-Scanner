# 📄 DocScan Pro — AI Document Scanner

**DocScan Pro** is a professional, web-based document scanner powered by **OpenCV** and **Python Flask**. It transforms your browser or mobile phone into a high-performance scanner with real-time document detection, perspective correction, and smart image processing.

![PWA Ready](https://img.shields.io/badge/PWA-Ready-7C5CFC?style=for-the-badge&logo=pwa&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-4.8-green?style=for-the-badge&logo=opencv)
![Flask](https://img.shields.io/badge/Flask-3.0-lightgrey?style=for-the-badge&logo=flask)

---

## ✨ Key Features

### 📸 Real-Time Camera Detection
- **Smart Overlay**: Instantly draws a green contour over detected documents in the live camera feed.
- **Stability Engine**: Intelligent tracking that waits for a stable frame before auto-capturing.
- **Multi-Strategy Pipeline**: Handles uneven lighting, shadows, and low-contrast backgrounds using a 4-layered computer vision algorithm.

### ⚙️ Professional Processing
- **Perspective Wrap**: Automatically transforms skewed document photos into flat, perfect rectangles.
- **Image Enhancement**: High-contrast filters to make text crisp and clear (Black & White scanning).
- **Multiple Formats**: Download your scans as high-quality **PNG** or properly formatted **A4 PDF**.

### 📱 Premium PWA Experience
- **Installable**: Add to your mobile home screen and use it like a native app.
- **Glassmorphic UI**: Beautiful, interactive interface with smooth animations and dark mode.
- **Lightweight**: Optimized for speed, processing frames in under 150ms.

---

## 🛠️ Technology Stack
- **Backend**: Python, Flask, OpenCV (Headless)
- **Frontend**: Vanilla JavaScript (ES6+), CSS3 (Modern Flex/Grid), HTML5 Canvas
- **PWA**: Web Manifest, Service Workers (Offline Shell)
- **PDF Generation**: jsPDF

---

## 🚀 Deployment

### Local Setup
1. Clone the repo:
   ```bash
   git clone https://github.com/PiyushSolanki038/Document-Scanner.git
   cd Document-Scanner
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the app:
   ```bash
   python app.py
   ```
4. Open `http://localhost:5000`

### Cloud Deployment (Render/Railway)
This project is pre-configured with a `Procfile` and `requirements.txt` for one-click deployment.
- **Note**: Ensure you deploy over **HTTPS** to enable camera access.

---

## 👨‍💻 Author
Developed with ❤️ by **Piyush Solanki**.
