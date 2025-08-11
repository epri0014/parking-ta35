let map = L.map('map').setView([-37.8136, 144.9631], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

let predictLayer = L.layerGroup().addTo(map);
let userMarker = null;

const searchBox = document.getElementById("searchBox");
const searchResults = document.getElementById("searchResults");
const clearBtn = document.getElementById("clearBtn");
const dtPicker = document.getElementById("dtPicker");

let selectedLocation = null; // {lat, lon, label}
let debounceTimer;

// init datetime picker: min = now (Melbourne timezone assumed by backend)
(function initDateTimePicker() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const localISO = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  dtPicker.min = localISO;
})();

searchBox.addEventListener("input", () => {
  const query = searchBox.value.trim();
  clearBtn.classList.toggle("d-none", !query);
  clearTimeout(debounceTimer);

  if (!query) {
    searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
    return;
  }

  searchResults.innerHTML = `
    <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
    <li class="dropdown-item disabled text-center">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading...
    </li>
  `;

  debounceTimer = setTimeout(() => {
    axios.get(`${ENV.BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`)
      .then(res => {
        searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
        res.data.forEach(loc => {
          const item = document.createElement("li");
          item.innerHTML = `<a class="dropdown-item" href="#" data-type="place" data-lat="${loc.lat}" data-lon="${loc.lon}">${loc.name}</a>`;
          searchResults.appendChild(item);
        });

        if (!searchResults.classList.contains('show')) {
          searchResults.classList.add('show');
        }
      })
      .catch(err => {
        console.error("Search error:", err);
        searchResults.innerHTML = `<li class="dropdown-item text-danger">Failed to fetch suggestions</li>`;
      });
  }, 1000);
});

searchResults.addEventListener("click", (e) => {
  e.preventDefault();
  const target = e.target;
  if (!target || target.tagName !== 'A') return;

  const type = target.dataset.type;

  if (type === "my-location") {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setLocation(lat, lon, "You are here");
    });
  } else {
    const lat = parseFloat(target.dataset.lat);
    const lon = parseFloat(target.dataset.lon);
    setLocation(lat, lon, "Selected Location");
  }

  searchBox.value = target.textContent;
  searchResults.classList.remove("show");
});

clearBtn.addEventListener("click", () => {
  searchBox.value = "";
  clearBtn.classList.add("d-none");
  searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
  resetPredictionUI();
});

function setLocation(lat, lon, label) {
  selectedLocation = { lat, lon, label };
  map.setView([lat, lon], 15);

  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.circleMarker([lat, lon], { radius: 8, color: '#007bff', fillColor: '#007bff', fillOpacity: 1 })
    .addTo(map).bindPopup(label).openPopup();

  // enable datetime picker once location is chosen
  dtPicker.disabled = false;

  // optionally clear existing prediction markers
  predictLayer.clearLayers();
}

function resetPredictionUI() {
  selectedLocation = null;
  dtPicker.value = "";
  dtPicker.disabled = true;
  predictLayer.clearLayers();
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
}

dtPicker.addEventListener("change", () => {
  if (!selectedLocation || !dtPicker.value) return;

  // Guard: ensure selected time is in the future
  const chosen = new Date(dtPicker.value);
  const now = new Date();
  if (chosen <= now) {
    alert("Please choose a future date and time.");
    return;
  }

  fetchPredictions(selectedLocation.lat, selectedLocation.lon, chosen.toISOString());
});

function fetchPredictions(lat, lon, datetimeISO) {
  predictLayer.clearLayers();

  // loading toast (simple)
  const loading = L.popup({ closeButton: false, autoClose: true })
      .setLatLng([lat, lon])
      .setContent('Predicting availability...')
      .openOn(map);

  axios.post(`${ENV.BACKEND_URL}/api/parking/predict`, {
    lat, lon, datetime_iso: datetimeISO
  })
  .then(res => {
    map.closePopup(loading);
    const data = res.data;
    const items = data.results || [];

    if (!items.length) {
      alert("No nearby candidates found within 1 km.");
      return;
    }

    items.forEach(item => {
      const isAvailable = item.predicted_status === "Available";
      const iconUrl = isAvailable
        ? 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
        : 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';
      
      const predClass = isAvailable ? 'text-success' : 'text-danger';
      const marker = L.marker([item.latitude, item.longitude], {
        icon: L.icon({
          iconUrl,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32]
        })
      });

      const restrictionsHtml = (item.restrictions || []).map((r, idx) =>
        `${idx + 1}. ${r.restriction_days}, ${r.time_restrictions_start} to ${r.time_restrictions_finish}, ${r.restriction_display}`
      ).join("<br>") || "No restrictions";

      marker.bindPopup(`
        <div style="font-size:0.9rem;">
          <b>Description :</b> ${item.description || "No description"}<br>
          <b>Predicted :</b> <span class="${predClass}">${item.predicted_status}</span> (conf: ${Math.round(item.confidence*100)}%)<br>
          <b>Model acc :</b> ~69% (RF baseline)<br><br>
          <b>Restriction</b><br>${restrictionsHtml}
        </div>
      `);

      marker.addTo(predictLayer);
    });
  })
  .catch(err => {
    map.closePopup(loading);
    console.error("Predict error:", err);
    alert("Failed to get prediction. Please try again.");
  });
}
