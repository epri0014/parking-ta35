let map = L.map('map').setView([-37.8136, 144.9631], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

let parkingLayer = L.layerGroup().addTo(map);
let userMarker = null;

const searchBox = document.getElementById("searchBox");
const searchResults = document.getElementById("searchResults");
const clearBtn = document.getElementById("clearBtn");

let debounceTimer;

searchBox.addEventListener("input", () => {
  const query = searchBox.value.trim();

  // Show/hide clear button
  clearBtn.classList.toggle("d-none", !query);

  clearTimeout(debounceTimer);

  if (!query) {
    searchResults.innerHTML = `<li><a class="dropdown-item" href="#" data-type="my-location">&#128205; My Location</a></li>`;
    return;
  }

  // Add spinner immediately
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

        // Show dropdown if not open
        if (!searchResults.classList.contains('show')) {
          searchResults.classList.add('show');
        }
      })
      .catch(err => {
        console.error("Search error:", err);
        searchResults.innerHTML = `<li class="dropdown-item text-danger">Failed to fetch suggestions</li>`;
      });
  }, 1000); // 1 second debounce
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
      if (!bays.length) {
        alert("No available bays within 1 kilometers.");
        return;
      }

      bays.forEach(bay => {
        const marker = L.marker([bay.lat, bay.lon], {
          icon: L.icon({
            iconUrl: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32]
          })
        });

        const restrictions = bay.restrictions?.map((r, idx) =>
          `${idx + 1}. ${r.restriction_days}, ${r.time_restrictions_start} to ${r.time_restrictions_finish}, ${r.restriction_display}`
        ).join("<br>") || "No restrictions";

        marker.bindPopup(`
          <div style="font-size: 0.9rem;">
            <b>Description :</b> ${bay.description}<br>
            <b>Status :</b> Unoccupied<br>
            <b>Status date :</b> ${new Date(bay.lastupdated).toLocaleString()}<br><br>
            <b>Restriction</b><br>${restrictions}
          </div>
        `);

        marker.addTo(parkingLayer);
      });
    });
}
