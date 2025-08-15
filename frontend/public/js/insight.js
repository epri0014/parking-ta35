const stateSelectVehicles = document.getElementById("stateSelectVehicles");
const stateSelectPopulation = document.getElementById("stateSelectPopulation");

let vehChart, popChart;
let statesCache = [];

/* ---------- Helpers ---------- */
function destroyChart(chart) {
  if (chart) chart.destroy();
}

function buildLineChart(ctx, points, titleText, xLabel, yLabel) {
  // points: [{x: yearNumber, y: valueNumber}, ...]
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  return new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: titleText,
        data: points,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: titleText
        },
        legend: {
          display: false
        },
        tooltip: {
          mode: 'nearest',
          intersect: false
        }
      },
      scales: {
        x: {
            type: 'category',
            title: { display: true, text: xLabel },
            labels: points.map(p => p.x.toString()), // convert years to strings
            ticks: {
                autoSkip: false
            }
        },
        y: {
          title: { display: true, text: yLabel },
          suggestedMin: Math.max(0, Math.floor(minY * 0.95)),
          suggestedMax: Math.ceil(maxY * 1.05),
          ticks: {
            // Format large numbers nicely
            callback: (v) => Intl.NumberFormat().format(v)
          }
        }
      }
    }
  });
}

function setSelectToVictoria(selectEl) {
  const vict = statesCache.find(s => (s.state_name || '').toLowerCase() === 'victoria');
  if (vict) selectEl.value = vict.state_id;
  else if (statesCache.length) selectEl.value = statesCache[0].state_id;
}

/* ---------- Data fetchers ---------- */
function loadStates() {
  return axios.get(`${ENV.BACKEND_URL}/api/insights/states`)
    .then(res => {
      statesCache = res.data || [];

      [stateSelectVehicles, stateSelectPopulation].forEach(sel => {
        sel.innerHTML = '';
        statesCache.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.state_id;
          opt.textContent = s.state_name;
          sel.appendChild(opt);
        });
      });

      // Default to Victoria on first load
      setSelectToVictoria(stateSelectVehicles);
      setSelectToVictoria(stateSelectPopulation);
    });
}

function loadVehicleSeries(stateId) {
  return axios.get(`${ENV.BACKEND_URL}/api/insights/vehicles?state_id=${stateId}`)
    .then(res => {
      const pts = (res.data || []).map(r => ({ x: Number(r.year), y: Number(r.total) }));
      return pts;
    });
}

function loadPopulationSeries(stateId) {
  return axios.get(`${ENV.BACKEND_URL}/api/insights/population?state_id=${stateId}`)
    .then(res => {
      const pts = (res.data || []).map(r => ({ x: Number(r.year), y: Number(r.population) }));
      return pts;
    });
}

/* ---------- Renderers ---------- */
function renderVehicles(stateId) {
  loadVehicleSeries(stateId).then(points => {
    const ctx = document.getElementById('vehicleChart').getContext('2d');
    destroyChart(vehChart);
    if (!points.length) {
      // show empty chart with default axes if needed
      vehChart = buildLineChart(ctx, [{x:0,y:0}], "Car Ownership Trend", "Year", "Number of Vehicles");
      return;
    }
    vehChart = buildLineChart(ctx, points, "Car Ownership Trend", "Year", "Number of Vehicles");
  });
}

function renderPopulation(stateId) {
  loadPopulationSeries(stateId).then(points => {
    const ctx = document.getElementById('populationChart').getContext('2d');
    destroyChart(popChart);
    if (!points.length) {
      popChart = buildLineChart(ctx, [{x:0,y:0}], "Population Trend", "Year", "Population");
      return;
    }
    popChart = buildLineChart(ctx, points, "Population Trend", "Year", "Population");
  });
}

/* ---------- Event wiring ---------- */
stateSelectVehicles.addEventListener('change', () => renderVehicles(stateSelectVehicles.value));
stateSelectPopulation.addEventListener('change', () => renderPopulation(stateSelectPopulation.value));

/* ---------- Init ---------- */
loadStates()
  .then(() => {
    // First render: Victoria selected by default
    renderVehicles(stateSelectVehicles.value);
    // Population chart will render when its tab is opened or we can pre-load now:
    renderPopulation(stateSelectPopulation.value);
  })
  .catch(err => console.error('Failed to load states:', err));
