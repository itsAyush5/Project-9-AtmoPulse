/**
 * Atmosphere — Global AQI Monitor
 * Click anywhere → full AQI + weather dashboard
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const WAQI_TOKEN = '587df79d4f5fc40d6632e23d8a2e16ca3d7cf816';
const WAQI_BASE  = 'https://api.waqi.info';
const NOM_BASE   = 'https://nominatim.openstreetmap.org';

const SEED_CITIES = [
    'New York','Los Angeles','Toronto','Mexico City','São Paulo','Buenos Aires',
    'London','Paris','Berlin','Madrid','Rome','Moscow','Lagos','Cairo',
    'Nairobi','Johannesburg','Dubai','Mumbai','New Delhi','Kolkata','Dhaka',
    'Karachi','Tehran','Istanbul','Beijing','Shanghai','Tokyo','Seoul',
    'Bangkok','Jakarta','Singapore','Sydney','Melbourne','Lima','Bogota',
    'Casablanca','Accra','Riyadh','Baghdad','Lahore','Chennai','Chengdu',
    'Guangzhou','Osaka','Wuhan','Kyiv','Taipei','Hanoi','Ho Chi Minh City'
];

const WMO_ICONS = {
    0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',
    51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',
    71:'🌨️',73:'🌨️',75:'❄️',77:'🌨️',
    80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'🌨️',
    95:'⛈️',96:'⛈️',99:'⛈️'
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function aqiColor(v) {
    if (v <= 50)  return '#10b981';
    if (v <= 100) return '#f59e0b';
    if (v <= 150) return '#f97316';
    if (v <= 200) return '#ef4444';
    if (v <= 300) return '#8b5cf6';
    return '#7e22ce';
}
function aqiStatus(v) {
    if (v <= 50)  return 'Good';
    if (v <= 100) return 'Moderate';
    if (v <= 150) return 'Sensitive';
    if (v <= 200) return 'Unhealthy';
    if (v <= 300) return 'Very Unhealthy';
    return 'Hazardous';
}
function aqiTip(v) {
    if (v <= 50)  return '✅ Air quality is satisfactory. Enjoy outdoor activities.';
    if (v <= 100) return '⚠️ Acceptable. Sensitive individuals may be affected.';
    if (v <= 150) return '😷 Sensitive groups should limit prolonged outdoor exertion.';
    if (v <= 200) return '🚫 Everyone may experience health effects. Limit outdoor time.';
    if (v <= 300) return '☠️ Health alert — avoid all outdoor activity.';
    return '🔴 Emergency conditions. Stay indoors with windows closed!';
}
function fmtDate(s) {
    return new Date(s + 'T00:00:00').toLocaleDateString('en', { weekday:'short', month:'short', day:'numeric' });
}
function iaqi(d, key) { return d?.iaqi?.[key]?.v ?? null; }

// ─── API CALLS ────────────────────────────────────────────────────────────────
async function apiGeo(lat, lon) {
    const r = await fetch(`${WAQI_BASE}/feed/geo:${lat};${lon}/?token=${WAQI_TOKEN}`);
    const j = await r.json();
    if (j.status !== 'ok') throw new Error(j.data || 'No data');
    return j.data;
}
async function apiSearch(q) {
    const r = await fetch(`${WAQI_BASE}/search/?keyword=${encodeURIComponent(q)}&token=${WAQI_TOKEN}`);
    const j = await r.json();
    if (j.status !== 'ok' || !j.data?.length) throw new Error('Not found');
    return j.data[0];
}
async function apiFeed(uid) {
    const r = await fetch(`${WAQI_BASE}/feed/@${uid}/?token=${WAQI_TOKEN}`);
    const j = await r.json();
    if (j.status !== 'ok') throw new Error('Feed error');
    return j.data;
}
async function apiBounds(s, w, n, e) {
    const r = await fetch(`${WAQI_BASE}/map/bounds/?latlng=${s},${w},${n},${e}&token=${WAQI_TOKEN}`);
    const j = await r.json();
    return j.status === 'ok' ? (j.data || []) : [];
}
async function apiWeather(lat, lon) {
    const p = `latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto&forecast_days=7`;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`);
    return r.json();
}
async function apiReverseGeo(lat, lon) {
    const r = await fetch(`${NOM_BASE}/reverse?lat=${lat}&lon=${lon}&format=json`, {
        headers: { 'Accept-Language': 'en' }
    });
    const j = await r.json();
    const a = j.address || {};
    return [a.city || a.town || a.village || a.county || j.display_name?.split(',')[0] || 'Unknown',
            j.display_name || ''];
}

// ─── APP ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // Elements
    const $loading  = document.getElementById('loading');
    const $panel    = document.getElementById('details-panel');
    const $content  = document.getElementById('details-content');
    const $fcast    = document.getElementById('forecast-content');
    const $weather  = document.getElementById('weather-content');
    const $close    = document.getElementById('close-details');
    const $search   = document.getElementById('search-input');
    const $btn      = document.getElementById('search-btn');
    const $hint     = document.getElementById('map-hint');

    let aqiChart    = null;
    const seen      = new Set();
    let boundsTimer = null;

    // ── Map ───────────────────────────────────────────────────────────────────
    const map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 2 })
                 .setView([20, 0], 3);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd', maxZoom: 19
    }).addTo(map);

    // ── Tabs ─────────────────────────────────────────────────────────────────
    function activateTab(name) {
        document.querySelectorAll('.tab-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === name));
        document.querySelectorAll('.tab-pane').forEach(p =>
            p.classList.toggle('active', p.id === 'pane-' + name));
    }
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.addEventListener('click', () => activateTab(b.dataset.tab)));

    // ── Core events ──────────────────────────────────────────────────────────
    $close.addEventListener('click', closePanel);
    $btn.addEventListener('click', doSearch);
    $search.addEventListener('keypress', e => { if (e.key === 'Enter') doSearch(); });

    // === CLICK ANYWHERE ON MAP ===
    map.on('click', e => {
        const { lat, lng } = e.latlng;
        loadDashboard(lat, lng, null);
    });

    map.on('moveend zoomend', () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(loadViewport, 1000);
    });

    // ── Boot ─────────────────────────────────────────────────────────────────
    (async () => {
        showGlobalLoading('Loading global stations…');
        await Promise.allSettled(SEED_CITIES.map(async city => {
            try {
                const st = await apiSearch(city);
                const aqi = parseInt(st.aqi);
                if (isNaN(aqi) || aqi < 0 || seen.has(st.uid)) return;
                seen.add(st.uid);
                addMarker({ uid: st.uid, name: st.station.name, lat: st.station.geo[0], lon: st.station.geo[1], aqi });
            } catch { /* skip */ }
        }));
        hideGlobalLoading();
        loadViewport();
    })();

    // ─────────────────────────────────────────────────────────────────────────
    async function loadViewport() {
        const b = map.getBounds();
        try {
            const stations = await apiBounds(
                b.getSouth().toFixed(3), b.getWest().toFixed(3),
                b.getNorth().toFixed(3), b.getEast().toFixed(3)
            );
            stations.forEach(s => {
                if (seen.has(s.uid)) return;
                seen.add(s.uid);
                const aqi = parseInt(s.aqi);
                if (isNaN(aqi) || aqi < 0) return;
                addMarker({ uid: s.uid, name: s.station.name, lat: s.station.geo[0], lon: s.station.geo[1], aqi });
            });
        } catch { /* ignore */ }
    }

    // ─────────────────────────────────────────────────────────────────────────
    function addMarker(loc) {
        const color = aqiColor(loc.aqi);
        const icon = L.divIcon({
            className: 'custom-marker-wrapper',
            html: `<div class="custom-marker" style="background:${color};box-shadow:0 0 12px ${color}66;"></div>`,
            iconSize: [16, 16], iconAnchor: [8, 8],
        });
        const m = L.marker([loc.lat, loc.lon], { icon }).addTo(map);
        m.bindTooltip(`<b>${loc.name}</b> · AQI ${loc.aqi} (${aqiStatus(loc.aqi)})`, {
            direction: 'top', offset: [0, -8], className: 'glass-tooltip'
        });
        m.on('click', e => {
            L.DomEvent.stopPropagation(e);
            loadDashboard(loc.lat, loc.lon, loc.name);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    async function loadDashboard(lat, lon, nameHint) {
        // Instantly open panel with skeleton
        if ($hint) $hint.style.opacity = '0';
        openPanel();
        activateTab('overview');
        renderSkeleton(nameHint || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`);

        try {
            // Fire all requests in parallel
            const [aqiData, weatherData, [cityShort, cityFull]] = await Promise.all([
                apiGeo(lat.toFixed(4), lon.toFixed(4)),
                apiWeather(lat, lon),
                nameHint ? Promise.resolve([nameHint, nameHint]) : apiReverseGeo(lat, lon)
            ]);

            const aqi      = typeof aqiData.aqi === 'number' ? aqiData.aqi : parseInt(aqiData.aqi);
            const forecast = aqiData.forecast?.daily || {};
            const details  = {
                pm2_5:            iaqi(aqiData, 'pm25'),
                pm10:             iaqi(aqiData, 'pm10'),
                ozone:            iaqi(aqiData, 'o3'),
                nitrogen_dioxide: iaqi(aqiData, 'no2'),
                carbon_monoxide:  iaqi(aqiData, 'co'),
                sulphur_dioxide:  iaqi(aqiData, 'so2'),
                humidity:         iaqi(aqiData, 'h'),
                temperature:      iaqi(aqiData, 't'),
                wind:             iaqi(aqiData, 'w'),
                pressure:         iaqi(aqiData, 'p'),
            };

            renderOverview(cityShort, cityFull, aqi, details, aqiData);
            renderForecast(forecast, aqi);
            renderWeather(weatherData);

        } catch (err) {
            $content.innerHTML = `
                <div style="padding:40px 16px;text-align:center;color:var(--text-secondary);">
                    <div style="font-size:2.5rem;">📡</div>
                    <p style="margin-top:12px;font-size:.9rem;">No monitoring station found near this point.</p>
                    <p style="margin-top:6px;font-size:.75rem;opacity:.6;">Try clicking on or near a city.</p>
                </div>`;
            $fcast.innerHTML = '';
            $weather.innerHTML = '';
        }
    }

    // ── Render Overview Tab ───────────────────────────────────────────────────
    function renderOverview(cityShort, cityFull, aqi, d, raw) {
        const color  = aqiColor(aqi);
        const status = aqiStatus(aqi);

        const stationName = raw?.city?.name || '';
        const updatedAt   = raw?.time?.s ? new Date(raw.time.s).toLocaleString('en', { hour:'2-digit', minute:'2-digit', month:'short', day:'numeric' }) : '';

        $content.innerHTML = `
            <div class="detail-header">
                <h2>${cityShort}</h2>
                ${cityFull !== cityShort ? `<p class="loc-sub">${cityFull.split(',').slice(1,3).join(',').trim()}</p>` : ''}
            </div>

            <div class="aqi-hero" style="border-top: 4px solid ${color}">
                <div class="aqi-big">
                    <div class="aqi-num" style="color:${color}">${aqi}</div>
                    <div class="aqi-label" style="color:${color}">${status}</div>
                </div>
                <div class="aqi-tip">${aqiTip(aqi)}</div>
            </div>

            <div class="section-label">Pollutants</div>
            <div class="pollutants-list">
                ${poll('PM2.5',  d.pm2_5)}
                ${poll('PM10',   d.pm10)}
                ${poll('O₃',    d.ozone)}
                ${poll('NO₂',   d.nitrogen_dioxide)}
                ${poll('CO',    d.carbon_monoxide)}
                ${poll('SO₂',   d.sulphur_dioxide)}
            </div>

            ${(d.humidity !== null || d.temperature !== null) ? `
            <div class="section-label" style="margin-top:16px;">Conditions</div>
            <div class="conditions-row">
                ${d.temperature !== null ? `<div class="cond-item"><div class="cond-val">${Math.round(d.temperature)}°C</div><div class="cond-key">Temp</div></div>` : ''}
                ${d.humidity    !== null ? `<div class="cond-item"><div class="cond-val">${Math.round(d.humidity)}%</div><div class="cond-key">Humidity</div></div>` : ''}
                ${d.wind        !== null ? `<div class="cond-item"><div class="cond-val">${Math.round(d.wind)} m/s</div><div class="cond-key">Wind</div></div>` : ''}
                ${d.pressure    !== null ? `<div class="cond-item"><div class="cond-val">${Math.round(d.pressure)}</div><div class="cond-key">hPa</div></div>` : ''}
            </div>` : ''}

            ${stationName ? `<div class="station-badge">
                📡 ${stationName}${updatedAt ? ` · ${updatedAt}` : ''}
            </div>` : ''}

            <div class="data-footer">
                <a href="https://waqi.info" target="_blank">WAQI</a> ·
                <a href="https://open-meteo.com" target="_blank">Open-Meteo</a> ·
                <a href="https://nominatim.org" target="_blank">Nominatim</a>
            </div>
        `;
    }

    // ── Render Forecast Tab ───────────────────────────────────────────────────
    function renderForecast(fc, currentAqi) {
        if (!fc?.pm25?.length) {
            $fcast.innerHTML = `
                <div class="no-data-msg">
                    <div>📊</div>
                    <p>No 7-day forecast data for this station.</p>
                </div>`;
            return;
        }

        const days  = fc.pm25.map(d => fmtDate(d.day));
        const pm25  = fc.pm25.map(d => d.avg ?? 0);
        const o3    = fc.o3  ? fc.o3.map(d => d.avg ?? 0) : null;

        $fcast.innerHTML = `
            <div class="section-label">7-Day PM2.5 Forecast</div>
            <div class="chart-wrap"><canvas id="aqi-chart"></canvas></div>
            ${fc.pm10 ? `<div class="section-label" style="margin-top:16px;">PM10 Daily</div>
            <div class="mini-bars">
                ${fc.pm10.map((d, i) => `
                    <div class="mini-bar-item">
                        <div class="mini-bar-fill" style="height:${Math.min(d.avg*1.2, 80)}px;background:${aqiColor(d.avg)};"></div>
                        <div class="mini-bar-val">${d.avg}</div>
                        <div class="mini-bar-day">${new Date(d.day+'T00:00:00').toLocaleDateString('en',{weekday:'short'})}</div>
                    </div>`).join('')}
            </div>` : ''}
        `;

        const ctx = document.getElementById('aqi-chart');
        if (!ctx) return;
        if (aqiChart) { aqiChart.destroy(); aqiChart = null; }

        const datasets = [{
            label: 'PM2.5 µg/m³',
            data: pm25,
            backgroundColor: pm25.map(v => aqiColor(v) + '88'),
            borderColor:     pm25.map(v => aqiColor(v)),
            borderWidth: 2,
            borderRadius: 8,
        }];
        if (o3) datasets.push({
            label: 'O₃ µg/m³',
            data: o3,
            backgroundColor: 'rgba(56,189,248,0.25)',
            borderColor: '#38bdf8',
            borderWidth: 2,
            borderRadius: 8,
            type: 'line',
            tension: 0.4,
            pointBackgroundColor: '#38bdf8',
        });

        aqiChart = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: { labels: days, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#94a3b8', font: { size: 11, family: 'Plus Jakarta Sans' } } },
                    tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y}` } }
                },
                scales: {
                    x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } },
                    y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' }, min: 0, beginAtZero: true }
                }
            }
        });
    }

    // ── Render Weather Tab ────────────────────────────────────────────────────
    function renderWeather(w) {
        if (!w?.daily?.time) {
            $weather.innerHTML = `<div class="no-data-msg"><div>🌤️</div><p>Weather data unavailable.</p></div>`;
            return;
        }
        const { time, temperature_2m_max, temperature_2m_min, precipitation_sum, weathercode } = w.daily;
        $weather.innerHTML = `
            <div class="section-label">7-Day Weather</div>
            <div class="weather-list">
                ${time.map((d, i) => `
                <div class="weather-card">
                    <div class="wc-day">${fmtDate(d)}</div>
                    <div class="wc-icon">${WMO_ICONS[weathercode[i]] || '🌡️'}</div>
                    <div class="wc-temp">
                        <span class="wc-max">${Math.round(temperature_2m_max[i])}°</span>
                        <span class="wc-min">${Math.round(temperature_2m_min[i])}°</span>
                    </div>
                    <div class="wc-rain">
                        <span>💧</span>
                        <span>${(precipitation_sum[i] || 0).toFixed(1)} mm</span>
                    </div>
                </div>`).join('')}
            </div>`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    function renderSkeleton(name) {
        $content.innerHTML = `
            <div class="detail-header">
                <h2>${name.split(',')[0]}</h2>
                <p class="loc-sub">Fetching atmospheric data…</p>
            </div>
            <div class="skeleton" style="height:120px;border-radius:20px;margin:16px 0;"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${Array(6).fill(`<div class="skeleton" style="height:60px;border-radius:12px;"></div>`).join('')}
            </div>`;
        $fcast.innerHTML   = `<div class="skeleton" style="height:200px;border-radius:12px;"></div>`;
        $weather.innerHTML = Array(7).fill(`<div class="skeleton" style="height:52px;border-radius:12px;margin-bottom:8px;"></div>`).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    async function doSearch() {
        const q = $search.value.trim();
        if (!q) return;
        showGlobalLoading(`Searching "${q}"…`);
        try {
            const r = await fetch(`${NOM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=1`, {
                headers: { 'Accept-Language': 'en' }
            });
            const j = await r.json();
            if (!j.length) throw new Error('Not found');
            const { lat, lon, display_name } = j[0];
            map.flyTo([+lat, +lon], 11, { animate: true, duration: 2 });
            $search.value = '';
            hideGlobalLoading();
            loadDashboard(+lat, +lon, display_name.split(',')[0].trim());
        } catch (err) {
            hideGlobalLoading();
            toast(err.message || 'City not found. Try a different name.');
        }
    }

    function openPanel() {
        $panel.classList.remove('slide-out');
        $panel.classList.add('slide-in');
    }
    function closePanel() {
        $panel.classList.remove('slide-in');
        $panel.classList.add('slide-out');
        if ($hint) setTimeout(() => { $hint.style.opacity = '1'; }, 600);
    }
    function showGlobalLoading(msg) {
        const p = $loading.querySelector('p');
        if (p) p.textContent = msg;
        $loading.classList.remove('hidden');
    }
    function hideGlobalLoading() { $loading.classList.add('hidden'); }

    function poll(name, val) {
        if (val == null) return '';
        return `<div class="pollutant-item">
            <div class="pollutant-name">${name}</div>
            <div class="pollutant-val">${typeof val === 'number' ? Math.round(val) : val}
                <span class="poll-unit">µg/m³</span></div>
        </div>`;
    }

    function toast(msg) {
        document.getElementById('toast')?.remove();
        const t = document.createElement('div');
        t.id = 'toast';
        t.textContent = msg;
        Object.assign(t.style, {
            position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(239,68,68,.92)', color: '#fff', padding: '12px 24px',
            borderRadius: '12px', fontSize: '.85rem', zIndex: 9999,
            backdropFilter: 'blur(8px)', whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    }
});
