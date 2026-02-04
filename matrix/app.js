const state = {
    primaryData: null,
    secondaryData: null,
    mode: 'single', // 'single' | 'compare'
    selectedFeatures: new Set(),
    activeView: 'matrix',
    simulatedFeaturesPrimary: {},
    simulatedFeaturesSecondary: {}
};

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

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    setupEventListeners();
    setupTheme();

    // Default load Bangalore 2024 as Primary
    await loadDataset(1, 'bangalore', '2024');
}


function setupEventListeners() {
    // Mode Switching
    document.querySelectorAll('.view-tab[data-mode]').forEach(el => {
        el.addEventListener('click', () => {
            const mode = el.dataset.mode;
            setMode(mode);
        });
    });

    // Dataset Selectors
    document.getElementById('city-select-1').addEventListener('change', refreshPrimary);
    document.getElementById('year-select-1').addEventListener('change', refreshPrimary);

    document.getElementById('city-select-2').addEventListener('change', refreshSecondary);
    document.getElementById('year-select-2').addEventListener('change', refreshSecondary);

    // Feature Toggles
    document.querySelectorAll('.feature-toggle[data-feature]').forEach(el => {
        el.addEventListener('click', () => {
            const feature = el.dataset.feature;
            if (state.selectedFeatures.has(feature)) {
                state.selectedFeatures.delete(feature);
                el.classList.remove('active');
            } else {
                state.selectedFeatures.add(feature);
                el.classList.add('active');
            }
            render();
        });
    });
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

function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.view-tab[data-mode]').forEach(t => t.classList.remove('active'));
    document.querySelector(`.view-tab[data-mode="${mode}"]`).classList.add('active');

    const secSelector = document.getElementById('selector-secondary');

    if (mode === 'compare') {
        secSelector.style.display = 'block';
        if (!state.secondaryData) {
            refreshSecondary();
        } else {
            render();
        }
    } else {
        secSelector.style.display = 'none';
        render();
    }
}

function refreshPrimary() {
    const city = document.getElementById('city-select-1').value;
    const year = document.getElementById('year-select-1').value;
    loadDataset(1, city, year);
}

function refreshSecondary() {
    const city = document.getElementById('city-select-2').value;
    const year = document.getElementById('year-select-2').value;
    loadDataset(2, city, year);
}

async function loadDataset(slot, city, year) {
    const loader = document.getElementById('loading-overlay');
    if (slot === 1 || state.mode === 'compare') loader.style.display = 'flex';

    let data = null;
    // Prefer detailed analysis for matrix view to get all metrics
    let url = `data/${city}_detailed_analysis.json`;
    let usedDetailed = true;

    try {
        let response = await fetch(url);

        if (!response.ok) {
            // Fallback to Grid Analysis if Detailed is missing
            usedDetailed = false;
            url = `data/${city}_grid_analysis_${year}.json`;
            response = await fetch(url);
            if (!response.ok) throw new Error(`Status ${response.status}`);
        }

        data = await response.json();

        // Handle GeoJSON (FeatureCollection) format - Common in detailed_analysis.json
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
        // Handle Legacy Wards format
        else if (!data.cells && data.wards) {
            data.cells = data.wards.map(w => {
                // If wards have keys like 'metrics_2024', flatten them
                const metricsKey = `metrics_${year}`;
                if (w[metricsKey]) {
                    return { ...w[metricsKey], cell_id: w.ward_id };
                }
                return { cell_id: w.ward_id };
            });
        }

        // Process Features
        const feats = extractFeatures(data, year);

        if (slot === 1) {
            state.primaryData = data;
            state.simulatedFeaturesPrimary = feats;
        } else {
            state.secondaryData = data;
            state.simulatedFeaturesSecondary = feats;
        }

        render();
    } catch (e) {
        console.error(e);
        if (slot === 1) {
            loader.innerHTML = `<div style="color:red">Failed to load ${city}</div>`;
            return;
        }
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
                // Set to null to indicate missing data for this feature
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

    if (state.selectedFeatures.size === 0) {
        el.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--secondary-color);">Select features from the sidebar to visualize the correlation matrix.</div>';
        el.style.display = 'block';
        return;
    } else {
        el.style.display = 'grid';
    }

    const feats = Array.from(state.selectedFeatures);
    el.style.gridTemplateColumns = `auto repeat(${feats.length}, 1fr)`;

    // Get readable labels for context
    const c1 = document.getElementById('city-select-1');
    const y1 = document.getElementById('year-select-1');
    const name1 = `${c1.options[c1.selectedIndex].text} ${y1.value}`;

    let infoText = `Analyzing: <span style="color:var(--text-color);font-weight:600">${name1}</span>`;

    if (state.mode === 'compare') {
        const c2 = document.getElementById('city-select-2');
        const y2 = document.getElementById('year-select-2');
        const name2 = `${c2.options[c2.selectedIndex].text} ${y2.value}`;
        infoText = `
            <div style="display:flex;justify-content:center;gap:2rem;font-size:0.9rem;padding-bottom:1rem;width:100%;">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <div style="width:12px;height:12px;background:rgba(34, 197, 94, 0.8);border:1px solid rgba(255,255,255,0.1);"></div>
                    <span>Upper ◣ : <b>${name1}</b></span>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <div style="width:12px;height:12px;background:rgba(239, 68, 68, 0.8);border:1px solid rgba(255,255,255,0.1);"></div>
                    <span>Lower ◢ : <b>${name2}</b></span>
                </div>
            </div>
        `;
    } else {
        infoText = `<div style="text-align:center;padding-bottom:1rem;font-size:0.95rem;">${infoText}</div>`;
    }

    let html = `<div style="grid-column: 1 / -1; color:var(--secondary-color);">${infoText}</div>`;

    html += `<div></div>` + feats.map(f => `<div style="text-align:center;color:var(--secondary-color);font-size:0.8rem;padding:0.5rem">${FEATURES[f].label}</div>`).join('');

    feats.forEach((rowF, rowIndex) => {
        html += `<div style="text-align:right;color:var(--secondary-color);font-size:0.8rem;padding:0.5rem">${FEATURES[rowF].label}</div>`;
        feats.forEach((colF, colIndex) => {
            let corr;
            let slot = 1;
            let tooltip = '';

            if (state.mode === 'compare') {
                if (rowIndex < colIndex) {
                    // Upper Triangle (Primary)
                    slot = 1;
                    corr = calculateCorrelation(rowF, colF, 1);
                    tooltip = "Primary Data (Upper Triangle)";
                } else if (rowIndex > colIndex) {
                    // Lower Triangle (Secondary)
                    slot = 2;
                    corr = calculateCorrelation(rowF, colF, 2);
                    tooltip = "Secondary Data (Lower Triangle)";
                } else {
                    // Diagonal
                    corr = 1.0;
                    tooltip = "Identity";
                }
            } else {
                // Single Mode
                corr = calculateCorrelation(rowF, colF, 1);
            }

            // Color Logic
            let color;
            let displayVal;

            if (isNaN(corr)) {
                color = 'var(--card-bg)'; // Neutral/NA color
                displayVal = '-';
            } else {
                displayVal = corr.toFixed(2);
                if (corr >= 0) {
                    const p = corr;
                    color = `rgb(${Math.round(30 + (6 - 30) * p)}, ${Math.round(41 + (182 - 41) * p)}, ${Math.round(59 + (212 - 59) * p)})`;
                } else {
                    const p = 1 + corr; // Map -1..0 to 0..1
                    color = `rgb(${Math.round(236 + (30 - 236) * p)}, ${Math.round(72 + (41 - 72) * p)}, ${Math.round(153 + (59 - 153) * p)})`;
                }
            }

            // Add indicator for secondary data in compare mode
            let borderStyle = '1px solid rgba(255,255,255,0.1)';
            if (state.mode === 'compare' && slot === 2) {
                borderStyle = '2px solid rgba(255, 255, 255, 0.3)'; // Highlight secondary cells slightly
            }

            html += `<div title="${tooltip}" style="background:${color};padding:1rem;text-align:center;color:white;border:${borderStyle}">${displayVal}</div>`;
        });
    });
    el.innerHTML = html;
}

function calculateCorrelation(f1, f2, slot = 1) {
    if (f1 === f2) return 1.0;

    const cells = slot === 1 ? state.primaryData?.cells : state.secondaryData?.cells;
    const feats = slot === 1 ? state.simulatedFeaturesPrimary : state.simulatedFeaturesSecondary;

    if (!cells || !feats) return NaN;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    let n = 0;

    for (const c of cells) {
        if (!feats[c.cell_id]) continue;
        const x = feats[c.cell_id][f1];
        const y = feats[c.cell_id][f2];

        // Filter invalid data (null, undefined, NaN, Infinity)
        if (x === null || y === null || !isFinite(x) || !isFinite(y)) continue;

        sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y;
        n++;
    }

    if (n < 2) return NaN; // Not enough data points

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    // Handle constant arrays (variance is 0)
    if (den === 0) return 0;

    return num / den;
}
