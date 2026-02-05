const FEATURES = {
    vegetation_index: { label: 'Vegetation (NDVI)', color: [34, 197, 94] },
    urban_density: { label: 'Urban Density', color: [59, 130, 246] },
    spatial_heterogeneity: { label: 'Urban Texture', color: [168, 85, 247] },
    uhi_risk_index: { label: 'Heat Risk', color: [239, 68, 68] },
    modified_water_index: { label: 'Water (MNDWI)', color: [6, 182, 212] },
    bare_soil_index: { label: 'Bare Soil', color: [217, 119, 6] },
    normalized_burn_ratio: { label: 'Land Health', color: [16, 185, 129] },
    index_based_built_up_index: { label: 'Built-up (IBI)', color: [249, 115, 22] },
    red_edge_index: { label: 'Dense Veg (NDRE)', color: [132, 204, 22] },
    surface_albedo: { label: 'Albedo', color: [234, 179, 8] },
    built_up_texture: { label: 'Built Texture', color: [99, 102, 241] }
};

const state = {
    primaryData: null,
    selectedFeatures: new Set(Object.keys(FEATURES)),
    simulatedFeaturesPrimary: {}
};

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    setupEventListeners();
    setupTheme();

    // Default load Bangalore 2024
    await loadDataset('bangalore', '2024');
}

function setupEventListeners() {
    // Dataset Selectors
    document.getElementById('city-select-1').addEventListener('change', refreshPrimary);
    document.getElementById('year-select-1').addEventListener('change', refreshPrimary);
}

function setupTheme() {
    const getStoredTheme = () => localStorage.getItem('theme');
    const setStoredTheme = theme => localStorage.setItem('theme', theme);

    const getPreferredTheme = () => {
        const storedTheme = getStoredTheme();
        if (storedTheme) {
            return storedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const setTheme = theme => {
        if (theme === 'auto') {
            document.documentElement.setAttribute('data-bs-theme', (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
        } else {
            document.documentElement.setAttribute('data-bs-theme', theme);
        }
    };

    setTheme(getPreferredTheme());

    const showActiveTheme = (theme, focus = false) => {
        const btnToActive = document.querySelector(`[data-bs-theme-value="${theme}"]`);

        document.querySelectorAll('[data-bs-theme-value]').forEach(element => {
            element.classList.remove('active');
            element.setAttribute('aria-pressed', 'false');
        });

        if (btnToActive) {
            btnToActive.classList.add('active');
            btnToActive.setAttribute('aria-pressed', 'true');
        }
    };

    document.querySelectorAll('[data-bs-theme-value]').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const theme = toggle.getAttribute('data-bs-theme-value');
            setStoredTheme(theme);
            setTheme(theme);
            showActiveTheme(theme, true);
        });
    });
}

function refreshPrimary() {
    const city = document.getElementById('city-select-1').value;
    const year = document.getElementById('year-select-1').value;
    loadDataset(city, year);
}

async function loadDataset(city, year) {
    const loader = document.getElementById('loading-overlay');
    loader.style.display = 'flex';

    let data = null;
    let url = `data/${city}_detailed_analysis.json`;

    try {
        let response = await fetch(url);

        if (!response.ok) {
            // Fallback
            url = `data/${city}_grid_analysis_${year}.json`;
            response = await fetch(url);
            if (!response.ok) throw new Error(`Status ${response.status}`);
        }

        data = await response.json();

        // Handle GeoJSON
        if (data.type === 'FeatureCollection') {
            data.cells = data.features.map(f => {
                const props = f.properties;
                const metricsKey = `metrics_${year}`;
                const m = props[metricsKey] || {};
                return {
                    cell_id: props.KGISWardID || props.ward_no || Math.random().toString(),
                    ...m
                };
            });
        }
        else if (!data.cells && data.wards) {
            data.cells = data.wards.map(w => {
                const metricsKey = `metrics_${year}`;
                if (w[metricsKey]) {
                    return { ...w[metricsKey], cell_id: w.ward_id };
                }
                return { cell_id: w.ward_id };
            });
        }

        // Process Features
        state.simulatedFeaturesPrimary = extractFeatures(data, year);
        state.primaryData = data;

        render();
    } catch (e) {
        console.error(e);
        loader.innerHTML = `<div style="color:red">Failed to load ${city}</div>`;
    } finally {
        loader.style.display = 'none';
    }
}

function extractFeatures(data, year) {
    const feats = {};
    const featureKeys = Object.keys(FEATURES);

    data.cells.forEach(cell => {
        const cellId = cell.cell_id;
        feats[cellId] = {};

        featureKeys.forEach(key => {
            if (cell[key] !== undefined && cell[key] !== null) {
                feats[cellId][key] = cell[key];
            } else {
                feats[cellId][key] = null;
            }
        });
    });

    return feats;
}

function render() {
    if (!state.primaryData) return;
    renderMatrix();
}

function renderMatrix() {
    const el = document.getElementById('correlation-heatmap');
    if (!el) return;

    el.style.display = 'grid';

    // Always show all features
    const feats = Array.from(state.selectedFeatures);
    el.style.gridTemplateColumns = `auto repeat(${feats.length}, 1fr)`;

    // Get readable labels for context
    const c1 = document.getElementById('city-select-1');
    const y1 = document.getElementById('year-select-1');
    const name1 = `${c1.options[c1.selectedIndex].text} ${y1.value}`;

    let infoText = `Analyzing: <span style="color:var(--text-color);font-weight:600">${name1}</span>`;
    infoText = `<div style="text-align:center;padding-bottom:1rem;font-size:0.95rem;">${infoText}</div>`;

    let html = `<div style="grid-column: 1 / -1; color:var(--secondary-color);">${infoText}</div>`;

    html += `<div></div>` + feats.map(f => `<div style="text-align:center;color:var(--secondary-color);font-size:0.8rem;padding:0.5rem">${FEATURES[f].label}</div>`).join('');

    feats.forEach(rowF => {
        html += `<div style="text-align:right;color:var(--secondary-color);font-size:0.8rem;padding:0.5rem">${FEATURES[rowF].label}</div>`;
        feats.forEach(colF => {
            const corr = calculateCorrelation(rowF, colF);

            // Color Logic
            let color;
            let displayVal;

            if (isNaN(corr)) {
                color = 'var(--card-bg)';
                displayVal = '-';
            } else {
                displayVal = corr.toFixed(2);
                const intensity = Math.abs(corr);

                // Industry Standard: Red (Negative) and Blue (Positive)
                if (corr >= 0) {
                    // Blue (Positive)
                    color = `rgba(59, 130, 246, ${Math.max(0.1, intensity)})`;
                } else {
                    // Red (Negative)
                    color = `rgba(239, 68, 68, ${Math.max(0.1, intensity)})`;
                }
            }

            const textColor = (!isNaN(corr) && Math.abs(corr) > 0.5) ? 'white' : 'var(--text-color)';
            const borderStyle = '1px solid rgba(255,255,255,0.1)';
            html += `<div title="Correlation: ${FEATURES[rowF].label} vs ${FEATURES[colF].label}" style="background:${color};padding:1rem;text-align:center;color:${textColor};border:${borderStyle}">${displayVal}</div>`;
        });
    });
    el.innerHTML = html;
}

function calculateCorrelation(f1, f2) {
    if (f1 === f2) return 1.0;

    const cells = state.primaryData?.cells;
    const feats = state.simulatedFeaturesPrimary;

    if (!cells || !feats) return NaN;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    let n = 0;

    for (const c of cells) {
        if (!feats[c.cell_id]) continue;
        const x = feats[c.cell_id][f1];
        const y = feats[c.cell_id][f2];

        if (x === null || y === null || !isFinite(x) || !isFinite(y)) continue;

        sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y;
        n++;
    }

    if (n < 2) return NaN;

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (den === 0) return 0;

    return num / den;
}
