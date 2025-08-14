let map = L.map('map').setView([-37.8136, 144.9631], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

let parkingLayer = L.layerGroup().addTo(map);
let userMarker = null;

const searchBox = document.getElementById("searchBox");
const searchResults = document.getElementById("searchResults");
const clearBtn = document.getElementById("clearBtn");

// Helper: ensure dropdown is open using Bootstrap API
function openDropdown() {
  const dd = bootstrap.Dropdown.getOrCreateInstance(searchBox);
  dd.show();
}

document.addEventListener('DOMContentLoaded', () => {
  new bootstrap.Dropdown(searchBox, {
    boundary: 'window',
    popperConfig: { strategy: 'fixed' } // helps on mobile & inside map containers
  });
  
  // Seed the menu with My Location so it's visible when we open the dropdown
  searchResults.innerHTML = `
    <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
  `;

  // Focus + select text
  searchBox.focus();
  searchBox.select();

  // Open dropdown immediately
  openDropdown();
});

// Also show dropdown whenever the field gains focus
searchBox.addEventListener('focus', openDropdown);

let debounceTimer;

searchBox.addEventListener("input", () => {
  const query = searchBox.value.trim();

  // Show/hide clear button
  clearBtn.classList.toggle("d-none", !query);

  clearTimeout(debounceTimer);

  if (!query) {
    // If empty, keep "My Location" visible AND keep the dropdown open
    searchResults.innerHTML = `
      <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
    `;
    openDropdown();                  // <-- keep it open with My Location
    return;
  }

  // Add spinner immediately
  searchResults.innerHTML = `
    <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
    <li class="dropdown-item disabled text-center">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading...
    </li>
  `;
  openDropdown();                    // <-- keep it open while loading

  debounceTimer = setTimeout(() => {
    axios.get(`${ENV.BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`)
      .then(res => {
        searchResults.innerHTML = `
          <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
        `;
        res.data.forEach(loc => {
          const item = document.createElement("li");
          item.innerHTML = `<a class="dropdown-item" href="#" data-type="place" data-lat="${loc.lat}" data-lon="${loc.lon}">${loc.name}</a>`;
          searchResults.appendChild(item);
        });

        // Re-open/ensure open after results arrive
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
      showLocation(lat, lon, "You are here");
    });
  } else {
    const lat = parseFloat(target.dataset.lat);
    const lon = parseFloat(target.dataset.lon);
    showLocation(lat, lon, "Selected Location");
  }

  searchBox.value = target.textContent;
  searchResults.classList.remove("show");
});

clearBtn.addEventListener("click", () => {
  searchBox.value = "";
  clearBtn.classList.add("d-none");

  // Reset dropdown to only "My Location"
  searchResults.innerHTML = `
    <li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>
  `;
});


function showLocation(lat, lon, label) {
  map.setView([lat, lon], 15);

  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.circleMarker([lat, lon], {
    radius: 8, color: '#007bff', fillColor: '#007bff', fillOpacity: 1
  }).addTo(map).bindPopup(label).openPopup();

  fetchParking(lat, lon);
}

function fetchParking(lat, lon) {
  parkingLayer.clearLayers();

  axios.get(`${ENV.BACKEND_URL}/api/parking/realtime?lat=${lat}&lon=${lon}`)
    .then(res => {
      const bays = res.data;

      // Always include the selected location in bounds
      const points = [[lat, lon]];

      if (!bays.length) {
        // Show the selected location clearly even if no results
        map.setView([lat, lon], 15);
        alert("No available bays within 1 kilometre.");
        return;
      }

      bays.forEach(bay => {
        points.push([bay.lat, bay.lon]);

        const marker = L.marker([bay.lat, bay.lon], {
          icon: L.icon({
            iconUrl: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32]
          })
        });

        const hasRestrictions = Array.isArray(bay.restrictions) && bay.restrictions.length > 0;
        const restrictionsHtml = hasRestrictions
          ? bay.restrictions.map((r, idx) =>
              `${idx + 1}. ${r.restriction_days}, ${r.time_restrictions_start} to ${r.time_restrictions_finish}, ${r.restriction_display}`
            ).join("<br>")
          : "No restrictions";

        // Pack raw displays for lookup (encoded JSON array)
        const codePayload = encodeURIComponent(JSON.stringify(
          (bay.restrictions || []).map(r => r.restriction_display || "")
        ));
        
        const lat = bay.lat;
        const lon = bay.lon;
        const mapsUrl = buildGMapsLink(lat, lon);

        marker.bindPopup(`
          <div style="font-size:0.9rem;">
            <div class="d-flex gap-2 align-items-center mt-2 popup-actions">
              <a class="gmaps-link" href="${mapsUrl}" target="_blank" rel="noopener">
                <span class="gmaps-emoji">&#128205;</span> Open in Google Maps
              </a>
            </div>
            <b>Description :</b> ${bay.description}<br>
            <b>Status :</b> <span class="text-success">Available</span><br>
            <b>Status date :</b> ${new Date(bay.lastupdated).toLocaleString()}<br><br>
            <b>Restriction</b>
            ${hasRestrictions ? `
              <button class="btn btn-link p-0 ms-1 align-baseline info-restrict"
                      title="Explain codes"
                      data-codes="${codePayload}">&#9432;</button>` : ""}
            <br>${restrictionsHtml}
          </div>
        `);

        marker.addTo(parkingLayer);
      });

      // Fit bounds so both the chosen point and all bays are centered & visible
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    })
    .catch(err => {
      console.error("Realtime fetch error:", err);
      alert("Failed to load parking data. Please try again.");
    });
}

