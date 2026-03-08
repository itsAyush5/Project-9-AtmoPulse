# 🌍 Atmosphere — Global AQI Monitor

A premium, real-time **Air Quality Index (AQI) monitor** for cities worldwide. Built with a modern glassmorphism dark UI, interactive Leaflet map, and powered by the [WAQI API](https://waqi.info).

**[➡ Live Demo on GitHub Pages](https://itsAyush5.github.io/Project-9-World-AQI-Monitor/)**

---

## ✨ Features

- 🗺️ **Interactive dark map** with glow-effect AQI markers
- 🔍 **Search any city** in the world using Nominatim geocoding
- 📊 **Detailed pollutant panel** — PM2.5, PM10, O₃, NO₂, CO, SO₂
- 🎨 **Premium glassmorphism UI** with smooth animations
- 📱 **Fully responsive** — works on mobile and desktop
- ⚡ **Zero backend** — 100% static, runs directly in browser

---

## 🚀 Deploy to GitHub Pages

This project is fully static and deploys to GitHub Pages out of the box.

1. **Fork or push** this repository to GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to `Deploy from a branch`, select `main` / `root` (`/`).
4. Your site will be live at `https://<username>.github.io/<repo-name>/`

> **Note:** No build step required. The root `index.html` is served directly.

---

## 🛠️ Run Locally (Static)

Just open `index.html` directly in your browser — or serve with any static server:

```bash
# Python
python -m http.server 8000

# Node.js (npx)
npx serve .
```

Then open `http://localhost:8000`.

## 🛠️ Run Locally (Flask Dev Server)

A Flask backend is also included for local development and iteration.

```bash
pip install -r requirements.txt
python app.py
```

---

## 🔑 API Token

The app uses a WAQI API token embedded in `static/script.js`.

- Token is **read-only** and rate-limited by WAQI.
- To use your own: get a free token at [aqicn.org/data-platform/token/](https://aqicn.org/data-platform/token/) and replace it in `static/script.js`:

```js
const WAQI_TOKEN = 'your-40-char-token-here';
```

---

## 📦 Tech Stack

| Layer      | Technology                      |
|------------|--------------------------------|
| Map        | [Leaflet.js](https://leafletjs.com) + CartoDB Dark tiles |
| AQI Data   | [WAQI API](https://waqi.info)  |
| Geocoding  | [Nominatim](https://nominatim.org) |
| Fonts      | Google Fonts — Outfit, Plus Jakarta Sans |
| Backend    | Flask (local dev only)         |

---

## 📄 License

MIT License — see [MIT License](MIT%20Liscense) file.
