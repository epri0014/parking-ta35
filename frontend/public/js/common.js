// Common UI helpers for ParkFinder
// --------------------------------
// Edit your catchphrase here. The navbar brand will become: "ParkFinder - <CATCHPHRASE>".
const APP_NAME = "&#128664; ParkFinder";
const CATCHPHRASE = "Less Circling, More Living"; // <-- change as you like

function setBrand() {
  document.querySelectorAll('.brand-name').forEach(el => el.innerHTML = APP_NAME);
  document.querySelectorAll('.brand-tag').forEach(el => el.innerHTML = CATCHPHRASE);
  // remove any legacy .brand-text usage
}

function setActiveNav() {
  const current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  document.querySelectorAll('.navbar a.nav-link').forEach(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    if (href === current) a.classList.add('active');
  });
}

function injectBackHome() {
  const slot = document.getElementById('backHomeSlot');
  if (!slot) return;
  const btn = document.createElement('a');
  btn.href = 'index.html';
  btn.className = 'btn btn-outline-secondary btn-sm';
  btn.textContent = '< Back to Home';
  slot.appendChild(btn);
}

document.addEventListener('DOMContentLoaded', () => {
  setBrand();
  setActiveNav();
  injectBackHome();
});

// ---------------- Restriction Code Lookup (shared) ----------------
const RESTRICTION_DICT = {
  "1P":   "1-hour time limit",
  "2P":   "2-hour time limit",
  "3P":   "3-hour time limit",
  "4P":   "4-hour time limit",
  "HP":   "30-minute time limit",
  "QP":   "15-minute time limit",
  "MP1P": "Metered parking - 1-hour time limit",
  "MP2P": "Metered parking - 2-hour time limit",
  "MP3P": "Metered parking - 3-hour time limit",
  "MPHP": "Metered parking - 4-hour time limit",
  "MPQP": "Metered parking - 30-minute time limit",
  "MP4P": "Metered parking - 15-minute time limit",
  "FP1P": "Free parking - 1-hour time limit",
  "FP2P": "Free parking - 2-hour time limit",
  "FP3P": "Free parking - 3-hour time limit",
  "FP4P": "Free parking - 4-hour time limit",
  "FPHP": "Free parking - 30-minute time limit",
  "FPQP": "Free parking - 15-minute time limit",
  "LZ30": "Loading zone - 30-minute limit"
};

// Find known codes in any text
function findRestrictionMatches(text) {
  if (!text) return [];
  const matches = [];
  for (const [code, desc] of Object.entries(RESTRICTION_DICT)) {
    const re = new RegExp(`\\b${code}\\b`, "i");
    if (re.test(text)) matches.push({ code, desc });
  }
  return matches;
}

// Create (once) and show a Bootstrap modal with matches
function showRestrictionInfo(matches) {
  let modalEl = document.getElementById("restrictInfoModal");
  if (!modalEl) {
    modalEl = document.createElement("div");
    modalEl.id = "restrictInfoModal";
    modalEl.className = "modal fade";
    modalEl.tabIndex = -1;
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Restriction Codes</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body"><div id="restrictInfoBody"></div></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modalEl);
  }

  const body = modalEl.querySelector("#restrictInfoBody");
  body.innerHTML = matches.length
    ? `<ul class="mb-0">${matches.map(m => `<li><code>${m.code}</code> - ${m.desc}</li>`).join("")}</ul>`
    : `<div class="text-muted">No known codes found in this restriction.</div>`;

  // CLOSE any open dropdowns (both visually and interactively)
  document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach(t => {
    try { bootstrap.Dropdown.getOrCreateInstance(t).hide(); } catch {}
  });
  document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
  document.activeElement?.blur();

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

// Delegate clicks from any popup's info icon
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".info-restrict");
  if (!btn) return;

  try {
    const payload = btn.getAttribute("data-codes") || "[]";
    const arr = JSON.parse(decodeURIComponent(payload));
    const bigText = Array.isArray(arr) ? arr.join(" ") : String(arr || "");
    const matches = findRestrictionMatches(bigText);
    showRestrictionInfo(matches);
  } catch (err) {
    console.error("Restriction info error:", err);
    showRestrictionInfo([]); // fallback
  }
});

// ---------- Likelihood (stars) helpers ----------
function likelihoodLabel(p) {
  if (p >= 0.80) return "Most likely";
  if (p >= 0.60) return "Likely";
  if (p >= 0.40) return "Could go either way";
  if (p >= 0.20) return "Less likely";
  return "Very unlikely";
}

function starsFromConfidence(p) {
  // p is 0..1 -> 1..5 stars
  const score = Math.min(5, Math.max(1, Math.ceil(p * 5)));
  const full = "\u2605".repeat(score);
  const empty = "\u2606".repeat(5 - score);
  return `<span class="stars stars-${score}" aria-hidden="true">${full}${empty}</span>`;
}

/** Returns HTML for the "How likely" row with a Bootstrap tooltip */
function renderLikelihood(conf) {
  const p = Number(conf || 0);                 // 0..1
  const pct = Math.round(p * 100);
  const label = likelihoodLabel(p);
  const stars = starsFromConfidence(p);
  const title = `${pct}% - ${label}`;
  return `
    <b>How likely :</b>
    <span class="ms-1" data-bs-toggle="tooltip" data-bs-placement="top" title="${title}">
      ${stars}
    </span>
  `;
}

// Build a cross-platform Google Maps link that opens the app if installed
function buildGMapsLink(lat, lon, label = "") {
  // `search` opens the place; `dir` would open directions
  const q = `${lat},${lon}`;
  const params = new URLSearchParams({
    api: "1",
    query: q,
    query_place_id: "", // optional if you had a place_id
  });
  if (label) params.set("query", `${q} (${label})`);
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
