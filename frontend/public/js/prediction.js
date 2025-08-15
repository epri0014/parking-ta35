let map = L.map('map').setView([-37.8136, 144.9631], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

let predictLayer = L.layerGroup().addTo(map);
let userMarker = null;

const searchBox     = document.getElementById("searchBox");
const searchResults = document.getElementById("searchResults");
const clearBtn      = document.getElementById("clearBtn");

const dtPicker      = document.getElementById("dtPicker");  // hidden native mirror
const dtInline      = document.getElementById("dtInline");  // visible flatpickr field

let selectedLocation = null; // {lat, lon, label}
let debounceTimer;
let fp = null;               // flatpickr instance

/* ---------- Helpers ---------- */
function openDropdown() {
  const dd = bootstrap.Dropdown.getOrCreateInstance(searchBox);
  dd.show();
}

function roundToNext15(d = new Date()) {
  return new Date(Math.ceil(d.getTime() / (15*60*1000)) * (15*60*1000));
}

function toLocalISO(dt) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// Initialize flatpickr as a normal input (opens on focus, closes on Apply)
function initFlatpickr() {
  if (fp) { fp.destroy(); fp = null; }
  fp = flatpickr(dtInline, {
    enableTime: true,
    time_24hr: true,
    minuteIncrement: 5,
    allowInput: false,
    // Don't set defaultDate so the field stays empty until user picks
    minDate: "today",
    disableMobile: true,        // <--- force Flatpickr UI on mobile
    appendTo: document.body,      // render calendar at the end of <body>
    // 'static' off: behaves like a normal popover; we handle z-index via CSS
    plugins: [ new confirmDatePlugin({
      showAlways: false,
      confirmText: "Apply",
      theme: "material_blue"
    }) ],
    onClose: (selectedDates) => {
      if (!selectedLocation) return;
      const sel = selectedDates?.[0];
      if (!sel) return;
      if (sel <= new Date()) {
        alert("Please choose a future date and time.");
        return;
      }
      dtPicker.value = toLocalISO(sel);                  // mirror to hidden native
      fetchPredictions(selectedLocation.lat, selectedLocation.lon, sel.toISOString());
    }
  });
}


// Fit map to include selected location + all markers
function fitMapToPoints(points) {
  if (!points.length) return;
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  new bootstrap.Dropdown(searchBox, {
    boundary: 'window',
    popperConfig: { strategy: 'fixed' } // helps on mobile & inside map containers
  });
  
  // Seed menu with My Location, focus input, open dropdown
  searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
  searchBox.focus();
  searchBox.select();
  openDropdown();

  // Prepare flatpickr (kept disabled until a location is chosen)
  initFlatpickr();
  dtInline.disabled = true;
});

searchBox.addEventListener('focus', openDropdown);

/* Keyboard: Enter on empty triggers My Location */
searchBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !searchBox.value.trim()) {
    e.preventDefault();
    const myLoc = searchResults.querySelector('a[data-type="my-location"]');
    if (myLoc) myLoc.click();
  }
});

/* ---------- Search Box ---------- */
searchBox.addEventListener("input", () => {
  const query = searchBox.value.trim();
  clearBtn.classList.toggle("d-none", !query);
  clearTimeout(debounceTimer);

  if (!query) {
    searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
    openDropdown();
    return;
  }

  searchResults.innerHTML = `
    <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
    <li class="dropdown-item disabled text-center">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading...
    </li>
  `;
  openDropdown();

  debounceTimer = setTimeout(() => {
    axios.get(`${ENV.BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`)
      .then(res => {
        searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
        res.data.forEach(loc => {
          const item = document.createElement("li");
          item.innerHTML = `<a class="dropdown-item" href="#" data-type="place" data-lat="${loc.lat}" data-lon="${loc.lon}">${loc.name}</a>`;
          searchResults.appendChild(item);
        });
        openDropdown();
      })
      .catch(err => {
        console.error("Search error:", err);
        searchResults.innerHTML = `<li class="dropdown-item text-danger">Failed to fetch suggestions</li>`;
        openDropdown();
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
    }, (err) => {
      console.error("Geolocation error:", err);
      alert("Unable to access your location.");
    });
  } else {
    const lat = parseFloat(target.dataset.lat);
    const lon = parseFloat(target.dataset.lon);
    setLocation(lat, lon, "Selected Location");
  }

  searchBox.value = target.textContent;
});

clearBtn.addEventListener("click", () => {
  searchBox.value = "";
  clearBtn.classList.add("d-none");
  searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;

  selectedLocation = null;
  predictLayer.clearLayers();
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }

  // Disable picker again
  dtInline.value = "";
  dtInline.disabled = true;

  openDropdown();
});

/* ---------- Location & Prediction ---------- */
function setLocation(lat, lon, label) {
  selectedLocation = { lat, lon, label };
  map.setView([lat, lon], 15);

  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.circleMarker([lat, lon], { radius: 8, color: '#007bff', fillColor: '#007bff', fillOpacity: 1 })
    .addTo(map).bindPopup(label).openPopup();

  // Enable picker; set default; auto-open it
  dtInline.disabled = false;
  fp.clear();
  
  // Mobile-friendly: focus then open after a microtask/paint
  setTimeout(() => {
    dtInline.focus({ preventScroll: true });
    fp.open();                   // primary
    // Fallback for stubborn mobile browsers:
    if (!document.querySelector('.flatpickr-calendar.open')) {
      dtInline.click();          // simulate a tap
      fp.open();                 // try again
    }
  }, 50);
}

/* Submit predictions after OK/Apply is clicked (handled in onClose via confirm plugin) */
function fetchPredictions(lat, lon, datetimeISO) {
  predictLayer.clearLayers();

  const loading = L.popup({ closeButton: false, autoClose: true })
      .setLatLng([lat, lon])
      .setContent('Predicting availability...')
      .openOn(map);

  axios.post(`${ENV.BACKEND_URL}/api/parking/predict`, { lat, lon, datetime_iso: datetimeISO })
  .then(res => {
    map.closePopup(loading);
    const items = (res.data && res.data.results) || [];

    if (!items.length) {
      alert("No nearby candidates found within 1 km.");
      return;
    }

    const points = [[lat, lon]]; // include selected location

    items.forEach(item => {
      const isAvailable = item.predicted_status === "Available";
      const iconUrl = isAvailable
        ? 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
        : 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';

      const marker = L.marker([item.latitude, item.longitude], {
        icon: L.icon({
          iconUrl,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32]
        })
      });

      points.push([item.latitude, item.longitude]);

      const p = Number(item.confidence || 0); // 0..1
      const likelihoodRow = renderLikelihood(p);

      const hasRestrictions = Array.isArray(item.restrictions) && item.restrictions.length > 0;
      const restrictionsHtml = hasRestrictions
        ? item.restrictions.map((r, idx) =>
            `${idx + 1}. ${r.restriction_days}, ${r.time_restrictions_start} to ${r.time_restrictions_finish}, ${r.restriction_display}`
          ).join("<br>")
        : "No restrictions";

      const codePayload = encodeURIComponent(JSON.stringify(
        (item.restrictions || []).map(r => r.restriction_display || "")
      ));

      const lat = item.latitude;
      const lon = item.longitude;
      const mapsUrl = buildGMapsLink(lat, lon);

      marker.bindPopup(`
        <div style="font-size:0.95rem; line-height:1.35;">
          <div class="d-flex gap-2 align-items-center mt-2 popup-actions">
            <a class="gmaps-link" href="${mapsUrl}" target="_blank" rel="noopener">
              <span class="gmaps-emoji">&#128205;</span> Open in Google Maps
            </a>
          </div>
          <div><b>Description :</b> ${item.description || "No description"}</div>
          <div><b>Predicted :</b> <span class="${isAvailable ? 'text-success' : 'text-danger'}">${item.predicted_status}</span></div>
          <div>${likelihoodRow}</div>

          <div class="mt-2">
            <b>Restriction</b>
            ${hasRestrictions ? `
              <button class="btn btn-link p-0 ms-1 align-baseline info-restrict"
                      title="Explain codes"
                      data-codes="${codePayload}">&#9432;</button>` : ""}
            <br>${restrictionsHtml}
          </div>
          <div class="mt-2 text-muted prediction-note">&#127919; Prediction powered by our AI parking model</div>
        </div>
    `);



      marker.addTo(predictLayer);
    });

    fitMapToPoints(points);
  })
  .catch(err => {
    map.closePopup(loading);
    console.error("Predict error:", err);
    alert("Failed to get prediction. Please try again.");
  });
}

map.on('popupopen', () => {
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    bootstrap.Tooltip.getOrCreateInstance(el);
  });
});

