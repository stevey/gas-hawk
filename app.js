'use strict';

const DATA_URL      = 'https://regieessencequebec.ca/stations.geojson.gz';
const CORS_PROXY    = 'https://corsproxy.io/?url=';
const LOCAL_FALLBACK = 'sample-data/stations.geojson';

// Buckets: find the best price within each radius
const BUCKETS = [
  { id: 'card-1km',   label: 'NEAREST',  maxKm: 1   },
  { id: 'card-10km',  label: 'CLOSE',    maxKm: 10  },
  { id: 'card-100km', label: 'REGIONAL', maxKm: 100 },
];

// GasType values in the API are French (e.g. "Régulier", "Super", "Diesel")
const GAS_TYPE_VARIANTS = {
  regular: ['régulier', 'regulier', 'regular', 'ordinaire'],
  super:   ['super', 'super sans plomb', 'premium'],
  diesel:  ['diesel', 'diésel'],
};

const state = {
  gasType:         localStorage.getItem('gasType')                            || 'regular',
  refreshInterval: parseInt(localStorage.getItem('refreshInterval') || '60', 10),
  stations:        null,   // cached feature array
  userLat:         null,
  userLng:         null,
  loading:         false,
  countdown:       0,
  countdownTimer:  null,
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Price in the API is a string like "190.9¢" — parse to a float (cents)
function parsePrice(raw) {
  if (typeof raw === 'number') return raw;
  // Strip everything except digits and decimal point
  return parseFloat(String(raw).replace(/[^\d.]/g, '')) || 0;
}

// cents (e.g. 190.9) → "$1.909"
function formatPrice(cents) {
  return `$${(cents / 100).toFixed(3)}`;
}

function formatDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

function matchesGasType(apiValue, selectedType) {
  const v = (apiValue || '').toLowerCase().trim();
  return GAS_TYPE_VARIANTS[selectedType]?.some(variant => v === variant) ?? false;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function openDirections(lat, lng, name) {
  const dest = `${lat},${lng}`;
  if (isIOS()) {
    window.location.href = `maps://maps.apple.com/?daddr=${dest}&q=${encodeURIComponent(name)}`;
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}`, '_blank');
  }
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function decompressGzip(buffer) {
  const ds     = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buffer));
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.length + c.length);
      merged.set(acc);
      merged.set(c, acc.length);
      return merged;
    }, new Uint8Array(0))
  );
}

async function fetchGeoJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  let text;
  try {
    text = await decompressGzip(buffer);
  } catch {
    // Proxy may have already decompressed it
    text = new TextDecoder().decode(buffer);
  }
  return JSON.parse(text);
}

async function loadStations() {
  // 1. Try direct remote (works if site has CORS headers)
  try {
    const data = await fetchGeoJSON(DATA_URL);
    console.log('Loaded from remote URL');
    return data.features || [];
  } catch (err) {
    console.warn('Direct fetch failed:', err.message);
  }

  // 2. Try via CORS proxy
  try {
    const data = await fetchGeoJSON(CORS_PROXY + encodeURIComponent(DATA_URL));
    console.log('Loaded via CORS proxy');
    return data.features || [];
  } catch (err) {
    console.warn('CORS proxy failed:', err.message);
  }

  // 3. Fall back to local sample file
  try {
    const resp = await fetch(LOCAL_FALLBACK);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log('Loaded from local sample file');
    return data.features || [];
  } catch (err) {
    throw new Error('Could not load station data from any source.');
  }
}

// ─── Geolocation ──────────────────────────────────────────────────────────────

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => reject(new Error('Location access denied — please enable location services.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

function findBestPrices(stations, userLat, userLng, gasType) {
  return BUCKETS.map(bucket => {
    let best      = null;
    let bestPrice = Infinity;

    for (const feature of stations) {
      const [lng, lat] = feature.geometry.coordinates;
      const dist = haversineKm(userLat, userLng, lat, lng);
      if (dist > bucket.maxKm) continue;

      const prices = feature.properties?.Prices ?? [];
      for (const p of prices) {
        if (!p.IsAvailable) continue;
        if (!matchesGasType(p.GasType, gasType)) continue;
        const cents = parsePrice(p.Price);
        if (cents < bestPrice) {
          bestPrice = cents;
          best = {
            lat, lng, dist,
            price:   cents,
            name:    feature.properties.Name || feature.properties.brand || 'Station',
            address: feature.properties.Address || '',
          };
        }
      }
    }

    return { ...bucket, result: best };
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderCards(bucketResults) {
  for (const bucket of bucketResults) {
    const card     = document.getElementById(bucket.id);
    const inner    = card.querySelector('.card-inner');
    const priceEl  = card.querySelector('.card-price');
    const stationEl = card.querySelector('.card-station');
    const distEl   = card.querySelector('.card-distance');

    inner.classList.remove('loading', 'empty');

    if (bucket.result) {
      const { price, name, address, dist, lat, lng } = bucket.result;
      priceEl.innerHTML = formatPrice(price) + '<span class="card-price-unit">/L</span>';
      stationEl.textContent = address ? `${name} — ${address}` : name;
      distEl.textContent    = formatDist(dist);
      card.onclick = () => openDirections(lat, lng, name);
    } else {
      inner.classList.add('empty');
      priceEl.textContent   = `None within ${bucket.maxKm} km`;
      stationEl.textContent = '';
      distEl.textContent    = '';
      card.onclick = null;
    }
  }
}

function setStatus(msg) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = msg;
}

// ─── Countdown & Refresh ──────────────────────────────────────────────────────

function startCountdown() {
  clearInterval(state.countdownTimer);
  state.countdown = state.refreshInterval;
  tickCountdown();
  state.countdownTimer = setInterval(tickCountdown, 1000);
}

function tickCountdown() {
  const el = document.getElementById('countdown');
  if (el) {
    const s = state.countdown;
    el.textContent = s >= 60
      ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      : `${s}s`;
  }
  if (state.countdown <= 0) {
    refresh();
  } else {
    state.countdown--;
  }
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  clearInterval(state.countdownTimer);

  const btn = document.getElementById('refreshBtn');
  if (btn) btn.style.opacity = '0.4';

  try {
    setStatus('Updating…');

    // Fetch stations once; re-use on subsequent refreshes
    const [location, stations] = await Promise.all([
      getLocation().catch(() => {
        if (state.userLat !== null) return { lat: state.userLat, lng: state.userLng };
        throw new Error('Location unavailable — please allow location access.');
      }),
      state.stations ? Promise.resolve(state.stations) : loadStations(),
    ]);

    state.userLat  = location.lat;
    state.userLng  = location.lng;
    state.stations = stations;

    const results = findBestPrices(stations, state.userLat, state.userLng, state.gasType);
    renderCards(results);

    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setStatus(`Updated ${t}`);
  } catch (err) {
    setStatus(err.message || 'Error loading data');
    console.error(err);
  } finally {
    state.loading = false;
    if (btn) btn.style.opacity = '';
    startCountdown();
  }
}

// Force a fresh data fetch (e.g. manual refresh button)
function forceRefresh() {
  state.stations = null;
  refresh();
}

// ─── UI Initialisation ────────────────────────────────────────────────────────

function initGasSelector() {
  const selector = document.getElementById('gasSelector');
  selector.querySelectorAll('.gas-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === state.gasType);
    btn.addEventListener('click', () => {
      state.gasType = btn.dataset.type;
      localStorage.setItem('gasType', state.gasType);
      selector.querySelectorAll('.gas-btn').forEach(b => b.classList.toggle('active', b === btn));
      // Re-render immediately from cached data if available
      if (state.userLat !== null && state.stations) {
        const results = findBestPrices(state.stations, state.userLat, state.userLng, state.gasType);
        renderCards(results);
      }
    });
  });
}

function initSettings() {
  const overlay    = document.getElementById('settingsOverlay');
  const panel      = document.getElementById('settingsPanel');
  const openBtn    = document.getElementById('settingsBtn');
  const closeBtn   = document.getElementById('closeSettings');
  const intervalSel = document.getElementById('intervalSelector');

  intervalSel.querySelectorAll('.option-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === state.refreshInterval);
    btn.addEventListener('click', () => {
      state.refreshInterval = parseInt(btn.dataset.value, 10);
      localStorage.setItem('refreshInterval', state.refreshInterval);
      intervalSel.querySelectorAll('.option-btn').forEach(b => b.classList.toggle('active', b === btn));
      // Reset countdown to new interval without re-fetching
      state.countdown = state.refreshInterval + 1;
    });
  });

  openBtn.addEventListener('click',  () => overlay.classList.remove('hidden'));
  closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click',  e => {
    if (!panel.contains(e.target)) overlay.classList.add('hidden');
  });
}

function initRefreshBtn() {
  document.getElementById('refreshBtn').addEventListener('click', forceRefresh);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initGasSelector();
  initSettings();
  initRefreshBtn();
  refresh();
});
