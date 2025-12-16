const state = {
  hits: 0,
  tries: 0,
  done: new Set(),
  byName: new Map(),        // nome -> feature (GeoJSON)
  layerByName: new Map(),   // nome -> Leaflet layer (bairros)
  labelByName: new Map(),   // nome -> tooltip ref
  bairrosGeojson: null
};

const $hits = document.getElementById("hits");
const $tries = document.getElementById("tries");
const $remaining = document.getElementById("remaining");
const $cards = document.getElementById("cards");
const $toast = document.getElementById("toast");
const $toggleLabels = document.getElementById("toggleLabels");

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  setTimeout(() => $toast.classList.remove("show"), 1300);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setCounters() {
  $hits.textContent = String(state.hits);
  $tries.textContent = String(state.tries);
  $remaining.textContent = String(Math.max(0, state.byName.size - state.done.size));
}

// ===== Leaflet map =====
const map = L.map("map", { zoomControl: true });

// Base layers
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
});

const esriSat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Tiles &copy; Esri" }
);

osm.addTo(map);

// Overlay layers
const overlayGroup = {
  "Bairros": L.layerGroup().addTo(map),
  "Avenidas de referência": L.layerGroup().addTo(map)
};

L.control.layers({ "Mapa (OSM)": osm, "Satélite (Esri)": esriSat }, overlayGroup, { collapsed: false }).addTo(map);

// Styles
function baseStyle() {
  return { color: "#333", weight: 1, fillColor: "#ffffff", fillOpacity: 0.12 };
}
function correctStyle() {
  return { color: "#1f7a1f", weight: 2, fillColor: "#1f7a1f", fillOpacity: 0.18 };
}
function hoverStyle() {
  return { color: "#111", weight: 2, fillOpacity: 0.22 };
}

function normalizeName(n) {
  return (n || "").trim();
}

// Convert drop event -> latlng
function dropLatLngFromEvent(e) {
  const containerPoint = map.mouseEventToContainerPoint(e);
  return map.containerPointToLatLng(containerPoint);
}

function isPointInsideFeature(latlng, feature) {
  const pt = turf.point([latlng.lng, latlng.lat]);
  return turf.booleanPointInPolygon(pt, feature);
}

// ===== Drag and drop cards =====
let draggingName = null;

function makeCard(name) {
  const el = document.createElement("div");
  el.className = "card";
  el.draggable = true;
  el.dataset.name = name;

  const left = document.createElement("div");
  left.textContent = name;

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "arraste";

  el.appendChild(left);
  el.appendChild(badge);

  el.addEventListener("dragstart", (ev) => {
    if (state.done.has(name)) return ev.preventDefault();
    draggingName = name;
    el.classList.add("dragging");
    ev.dataTransfer.setData("text/plain", name);
    ev.dataTransfer.effectAllowed = "move";
  });

  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    draggingName = null;
  });

  return el;
}

// Enable dropping onto map
const mapEl = document.getElementById("map");
mapEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
});

mapEl.addEventListener("drop", (e) => {
  e.preventDefault();
  const name = e.dataTransfer.getData("text/plain") || draggingName;
  if (!name || state.done.has(name)) return;

  const latlng = dropLatLngFromEvent(e);

  state.tries += 1;
  setCounters();

  const feat = state.byName.get(name);
  if (!feat) return toast("Bairro não encontrado na base.");

  const ok = isPointInsideFeature(latlng, feat);

  if (ok) {
    state.hits += 1;
    state.done.add(name);
    setCounters();

    const layer = state.layerByName.get(name);
    if (layer) layer.setStyle(correctStyle());

    const card = [...document.querySelectorAll(".card")].find(c => c.dataset.name === name);
    if (card) {
      card.classList.add("done");
      card.draggable = false;
      card.querySelector(".badge").textContent = "certo";
    }
    toast(`Correto: ${name}`);
  } else {
    toast(`Incorreto: ${name}`);
  }
});

// Toggle labels
$toggleLabels.addEventListener("change", () => {
  const show = $toggleLabels.checked;
  for (const [name, layer] of state.layerByName.entries()) {
    if (show) {
      layer.bindTooltip(name, { permanent: true, direction: "center", className: "bairroLabel" });
      layer.openTooltip();
    } else {
      layer.unbindTooltip();
    }
  }
});

// ===== Load data =====
async function loadGeoJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Falha ao carregar ${path}`);
  return res.json();
}

async function init() {
  // 1) Bairros
  const bairros = await loadGeoJSON("./bairros.geojson");
  state.bairrosGeojson = bairros;

  const feats = bairros.features || [];
  feats.forEach(f => {
    const name = normalizeName(f.properties?.nome);
    if (!name) return;
    state.byName.set(name, f);
  });

  // sidebar cards
  const names = shuffle([...state.byName.keys()]);
  $cards.innerHTML = "";
  names.forEach(n => $cards.appendChild(makeCard(n)));

  // add bairros to map
  const bairrosLayer = L.geoJSON(bairros, {
    style: baseStyle,
    onEachFeature: (feature, layer) => {
      const name = normalizeName(feature.properties?.nome);
      if (name) state.layerByName.set(name, layer);

      layer.on("mouseover", () => layer.setStyle(hoverStyle()));
      layer.on("mouseout", () => {
        if (name && state.done.has(name)) layer.setStyle(correctStyle());
        else layer.setStyle(baseStyle());
      });

      if ($toggleLabels.checked && name) {
        layer.bindTooltip(name, { permanent: true, direction: "center", className: "bairroLabel" });
        layer.openTooltip();
      }
    }
  }).addTo(overlayGroup["Bairros"]);

  map.fitBounds(bairrosLayer.getBounds(), { padding: [10, 10] });

  // 2) Avenidas (overlay)
  const avenidas = await loadGeoJSON("./avenidas.geojson");
  L.geoJSON(avenidas, {
    style: (feature) => ({
      color: feature.properties?.cor || "#000",
      weight: 5,
      opacity: 0.9
    }),
    onEachFeature: (feature, layer) => {
      const nm = feature.properties?.nome || "Avenida";
      layer.bindTooltip(nm, { permanent: false, direction: "top" });
    }
  }).addTo(overlayGroup["Avenidas de referência"]);

  setCounters();
}

document.getElementById("finishBtn").addEventListener("click", () => {
  const total = state.byName.size;
  const hits = state.hits;
  const tries = state.tries;
  alert(`Resultado final:\n\nAcertos: ${hits}/${total}\nTentativas: ${tries}`);
});

document.getElementById("resetBtn").addEventListener("click", () => location.reload());

init().catch(err => {
  console.error(err);
  toast("Erro ao carregar os dados. Verifique se bairros.geojson está na pasta.");
});
const toggleBtn = document.getElementById("toggleSidebar");
const sidebar = document.querySelector(".sidebar");

if (toggleBtn && sidebar) {
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("hidden");
  });
}
