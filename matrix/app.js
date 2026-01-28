const state = {
    primaryData: null,
    secondaryData: null,
    mode: 'single', // 'single' | 'compare'
    compareMode: 'animating', // 'animating' | 'delta'
    animationValue: 0, // 0 to 1 (0=Primary, 1=Secondary)
    isAnimating: false,
    selectedFeatures: new Set(['vegetation_index', 'urban_density']),
    activeView: 'grid',
    hoveredCell: null,
    bounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    canvas: { width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 }
};

const FEATURES = {
    vegetation_index: { label: 'Vegetation Index', color: [34, 197, 94] },
    urban_density: { label: 'Urban Density', color: [59, 130, 246] },
    correlation_distance: { label: 'Correlation Distance', color: [234, 88, 12] }
};

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    setupEventListeners();
    handleResize();

    // Default load London 2024 as Primary
    await loadDataset(1, 'london', '2024');

    // We do NOT preload secondary immediately to save bandwith, wait for user.
}



function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setupEventListeners() {
    // Theme Change Listener (Polling as attribute change event isn't direct)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-bs-theme') {
                render();
            }
        });
    });
    observer.observe(document.documentElement, { attributes: true });


    // Mode Switching
    document.querySelectorAll('.view-tab[data-mode]').forEach(el => {
        el.addEventListener('click', () => {
            const mode = el.dataset.mode;
            setMode(mode);
        });
    });

    // ... (rest same) ...

    function setMode(mode) {
        state.mode = mode;
        document.querySelectorAll('.view-tab[data-mode]').forEach(t => t.classList.remove('active'));
        document.querySelector(`.view-tab[data-mode="${mode}"]`).classList.add('active');

        const secSelector = document.getElementById('selector-secondary');

        if (mode === 'compare') {
            secSelector.style.display = 'block';
            // Auto-load secondary if empty
            if (!state.secondaryData) {
                refreshSecondary();
            }
        } else {
            secSelector.style.display = 'none';
            state.isAnimating = false;
            render(); // Revert to single view
        }
    }

    // Dataset Selectors
    document.getElementById('city-select-1').addEventListener('change', refreshPrimary);
    document.getElementById('year-select-1').addEventListener('change', refreshPrimary);

    document.getElementById('city-select-2').addEventListener('change', refreshSecondary);
    document.getElementById('year-select-2').addEventListener('change', refreshSecondary);

    // Feature Toggles (Main features)
    document.querySelectorAll('.feature-toggle[data-feature]').forEach(el => {
        el.addEventListener('click', () => {
            const feature = el.dataset.feature;
            if (state.selectedFeatures.has(feature)) {
                state.selectedFeatures.delete(feature);
                el.classList.remove('selected');
            } else {
                state.selectedFeatures.add(feature);
                el.classList.add('selected');
            }
            render();
        });
    });

    // Compare Controls
    document.getElementById('animate-btn').addEventListener('click', () => {
        state.compareMode = 'animating';
        toggleAnimation();
    });

    document.getElementById('velocity-btn').addEventListener('click', () => {
        state.compareMode = 'delta';
        state.isAnimating = false;
        state.animationValue = 1; // Show full effect
        render();
    });

    // View Tabs (Grid vs Matrix)
    document.querySelectorAll('.view-tab[data-view]').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.view-tab[data-view]').forEach(t => t.classList.remove('active'));
            el.classList.add('active');

            const view = el.dataset.view;
            state.activeView = view;

            document.getElementById('grid-view').style.display = view === 'grid' ? 'block' : 'none';
            document.getElementById('matrix-view').style.display = view === 'matrix' ? 'block' : 'none';

            render();
        });
    });

    // Run Grid Search Button - Switches to Matrix View
    document.getElementById('run-correlation-btn').addEventListener('click', () => {
        // Activate Matrix Tab
        document.querySelectorAll('.view-tab[data-view]').forEach(t => t.classList.remove('active'));
        document.querySelector('.view-tab[data-view="matrix"]').classList.add('active');

        // Show Matrix View
        state.activeView = 'matrix';
        document.getElementById('grid-view').style.display = 'none';
        document.getElementById('matrix-view').style.display = 'block';

        render();
    });

    // Canvas Interactions
    const canvas = document.getElementById('matrix-canvas');
    canvas.addEventListener('mousemove', handleCanvasHover);
    canvas.addEventListener('mouseleave', () => {
        state.hoveredCell = null;
        document.getElementById('tooltip').style.display = 'none';
        renderGrid();
    });
}

function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.view-tab[data-mode]').forEach(t => t.classList.remove('active'));
    document.querySelector(`.view-tab[data-mode="${mode}"]`).classList.add('active');

    const secSelector = document.getElementById('selector-secondary');
    if (mode === 'compare') {
        secSelector.style.display = 'block';
        // Reset animation
        state.animationValue = 0;
        state.compareMode = 'animating';
    } else {
        secSelector.style.display = 'none';
        state.isAnimating = false;
    }
    render();
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
    // Only show loader if loading primary (blocking) or if comparing
    if (slot === 1 || state.mode === 'compare') loader.style.display = 'flex';

    const url = `data/${city}_grid_analysis_${year}.json`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();

        if (slot === 1) {
            state.primaryData = data;
            // Recalculate bounds only on primary change
            calculateBounds(data);
        } else {
            state.secondaryData = data;
        }

        render();
    } catch (e) {
        console.error(e);
        // Fallback or error handled silently in logs for demo smoothness unless critical
        if (slot === 1) {
            loader.innerHTML = `<div style="color:red">Failed to load ${city} ${year}</div>`;
            return;
        }
    } finally {
        loader.style.display = 'none';
    }
}

function calculateBounds(data) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    data.cells.forEach(cell => {
        const coords = cell.geometry.coordinates[0];
        coords.forEach(pt => {
            if (pt[0] < minX) minX = pt[0];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[1] > maxY) maxY = pt[1];
        });
    });
    // Add small buffer
    const w = maxX - minX;
    const h = maxY - minY;
    minX -= w * 0.05;
    maxX += w * 0.05;
    minY -= h * 0.05;
    maxY += h * 0.05;

    state.bounds = { minX, maxX, minY, maxY };
}

// Animation Loop
function toggleAnimation() {
    if (state.isAnimating) {
        state.isAnimating = false;
        return;
    }

    state.isAnimating = true;
    let direction = 1;

    function step() {
        if (!state.isAnimating) return;

        state.animationValue += 0.02 * direction;

        if (state.animationValue >= 1) {
            state.animationValue = 1;
            direction = -1;
            // Pause briefly at end
        } else if (state.animationValue <= 0) {
            state.animationValue = 0;
            direction = 1;
        }

        render();
        requestAnimationFrame(step);
    }
    step();
}

function handleResize() {
    const canvas = document.getElementById('matrix-canvas');
    // Ensure parent has size
    if (canvas.parentElement.clientWidth === 0) return;

    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    render();
}
window.addEventListener('resize', handleResize);

function render() {
    if (!state.primaryData) return;

    if (state.activeView === 'grid') renderGrid();
    else renderMatrix();
}

function renderGrid() {
    const canvas = document.getElementById('matrix-canvas');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const { minX, maxX, minY, maxY } = state.bounds;

    ctx.fillStyle = getCSSVar('--canvas-bg');
    ctx.fillRect(0, 0, width, height);

    if (state.mode === 'compare' && !state.secondaryData) {
        // Waiting for secondary
        ctx.fillStyle = getCSSVar('--canvas-text');
        ctx.font = '20px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("Select Comparison Dataset...", width / 2, height / 2);
        return;
    }

    const dataW = maxX - minX;
    const dataH = maxY - minY;

    // Scale preserving aspect
    const padding = 20;
    const scale = Math.min((width - padding * 2) / dataW, (height - padding * 2) / dataH);
    const offsetX = padding + (width - padding * 2 - dataW * scale) / 2;
    const offsetY = padding + (height - padding * 2 - dataH * scale) / 2;

    state.canvas = { width, height, scale, offsetX, offsetY }; // Store for hit test

    const primaryFeature = Array.from(state.selectedFeatures)[0] || 'urban_density';
    const colorBase = FEATURES[primaryFeature].color;

    // We iterate PRIMARY cells (assuming geometry matches or is close enough for simple comparison)
    // If comparing different cities (Bangalore vs Delhi), geometry WONT match. 
    // This is "Side-by-Side" logic. 
    // If geometry differs significantly, we can't blend nicely in place without re-projecting or splitting screen.
    // For now, if bounds are vastly different (different cities), animation just morphs geometry if we iterate index-by-index? 
    // No, index-by-index on different cities makes no sense.
    // **Solution**: If comparing different cities, we just show Primary. 
    // The requirement was "Side-by-side comparison... Bangalore vs Ahmedabad".
    // Since I implemented "Single/Compare" toggle, if it's different cities, I should ideally split screen. Assumed same-city temporal for animation.

    // Let's detect if geometries mismatch significantly.
    const isSameCity = (state.primaryData.city === (state.secondaryData?.city || ''));

    // If Not Same City -> We assume user wants Temporal velocity (same city) OR strict comparison. 
    // Users request: "Side-by-Side (Bangalore vs ...)"
    // If Compare Mode AND Different Cities: Split the canvas? 
    // Implementing simple Split View Logic for 'Compare' mode if bounds mismatch.

    const isSplitView = state.mode === 'compare' && !isSameCity;

    if (isSplitView && state.secondaryData) {
        state.isAnimating = false; // Disable animation for split view
        renderSplitView(ctx, primaryFeature);
        return;
    }

    // Standard Render (Single or Temporal Morph)
    state.primaryData.cells.forEach((cell, i) => {
        let val = cell[primaryFeature] ?? 0;

        if (state.mode === 'compare' && state.secondaryData && state.secondaryData.cells[i]) {
            const val2 = state.secondaryData.cells[i][primaryFeature] ?? 0;

            if (state.compareMode === 'delta') {
                // Show Difference: Green for increase, Red for decrease?
                const diff = val2 - val; // 2024 - 2019
                // Map diff (-1 to 1) to Color
                // 0 = Black
                // + = Green/Blue
                // - = Red
                const intensity = Math.abs(diff);
                const r = diff < 0 ? 255 : 30;
                const g = diff > 0 ? 255 : 30;
                const b = 30;
                ctx.fillStyle = `rgb(${r * intensity}, ${g * intensity}, ${b})`;
            } else {
                // Animation Morph
                const t = state.animationValue;
                val = val * (1 - t) + val2 * t;
                const r = Math.floor(colorBase[0] * (0.1 + 0.9 * val));
                const g = Math.floor(colorBase[1] * (0.1 + 0.9 * val));
                const b = Math.floor(colorBase[2] * (0.1 + 0.9 * val));
                ctx.fillStyle = `rgb(${r},${g},${b})`;
            }
        } else {
            // Single Mode
            const r = Math.floor(colorBase[0] * (0.1 + 0.9 * val));
            const g = Math.floor(colorBase[1] * (0.1 + 0.9 * val));
            const b = Math.floor(colorBase[2] * (0.1 + 0.9 * val));
            ctx.fillStyle = `rgb(${r},${g},${b})`;
        }

        if (state.hoveredCell && state.hoveredCell.cell_id === cell.cell_id) {
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#fff';
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        cell.geometry.coordinates[0].forEach((pt, idx) => {
            const px = (pt[0] - minX) * scale + offsetX;
            const py = height - ((pt[1] - minY) * scale + offsetY);
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.fill();
    });
}

function renderSplitView(ctx, feature) {
    const { width, height } = state.canvas; // canvas dims from resize
    const halfW = width / 2;

    // Draw Separator
    ctx.strokeStyle = getCSSVar('--divider-color');
    ctx.beginPath(); ctx.moveTo(halfW, 0); ctx.lineTo(halfW, height); ctx.stroke();

    // Render Left (Primary)
    renderDatasetOnCanvas(ctx, state.primaryData, feature, 0, 0, halfW, height);

    // Render Right (Secondary)
    renderDatasetOnCanvas(ctx, state.secondaryData, feature, halfW, 0, halfW, height);

    // Labels
    ctx.fillStyle = getCSSVar('--canvas-text');
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(`${state.primaryData.city} ${state.primaryData.year}`, halfW / 2, 30);
    ctx.fillText(`${state.secondaryData.city} ${state.secondaryData.year}`, halfW + halfW / 2, 30);
}

function renderDatasetOnCanvas(ctx, data, feature, dx, dy, dw, dh) {
    // Calc bounds locally for this dataset to fit in sub-window
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    data.cells.forEach(c => {
        c.geometry.coordinates[0].forEach(p => {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        });
    });
    const dW = maxX - minX;
    const dH = maxY - minY;

    const pad = 10;
    const scale = Math.min((dw - 2 * pad) / dW, (dh - 2 * pad) / dH);

    const offX = dx + pad + (dw - 2 * pad - dW * scale) / 2;
    const offY = dy + pad + (dh - 2 * pad - dH * scale) / 2;

    const color = FEATURES[feature].color;

    data.cells.forEach(cell => {
        const val = cell[feature] ?? 0;
        const r = Math.floor(color[0] * val);
        const g = Math.floor(color[1] * val);
        const b = Math.floor(color[2] * val);
        ctx.fillStyle = `rgb(${r},${g},${b})`;

        ctx.beginPath();
        cell.geometry.coordinates[0].forEach((pt, i) => {
            const px = (pt[0] - minX) * scale + offX;
            const py = dh - ((pt[1] - minY) * scale + (dh - offY - dH * scale));
            // Fix Y flip logic for sub-window:
            // py = (dh + dy) - ((pt[1] - minY) * scale + padding_offset_from_bottom)
            // Easier: py = dy + dh - ( ... )
            // Correct Y pixel:
            const yRel = (pt[1] - minY) * scale; // 0 to scaledH
            const screenY = (dy + dh) - (pad + (dh - 2 * pad - dH * scale) / 2) - yRel;

            if (i === 0) ctx.moveTo(px, screenY); else ctx.lineTo(px, screenY);
        });
        ctx.fill();
    });
}

function handleCanvasHover(e) {
    // Only support hover on primary in Single mode, or more complex in compare?
    // For stability/robustness, let's keep hover working on Single mode basically.
    if (state.mode === 'compare') return;

    // Legacy hover logic for Single mode
    if (!state.primaryData) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const { minX, minY, scale, offsetX, offsetY, height } = state.canvas;
    const mouseLon = (x - offsetX) / scale + minX;
    const mouseLat = ((height - y - offsetY) / scale) + minY;

    let closest = null;
    let minD2 = (0.0015) ** 2;

    state.primaryData.cells.forEach(cell => {
        const p0 = cell.geometry.coordinates[0][0];
        const d2 = (p0[0] - mouseLon) ** 2 + (p0[1] - mouseLat) ** 2;
        if (d2 < minD2) { minD2 = d2; closest = cell; }
    });

    if (closest !== state.hoveredCell) {
        state.hoveredCell = closest;
        renderGrid();
        updateTooltip(e.clientX, e.clientY);
    }
}

function updateTooltip(x, y) {
    const t = document.getElementById('tooltip');
    if (!state.hoveredCell) { t.style.display = 'none'; return; }

    t.style.display = 'block';
    t.style.left = (x + 15) + 'px'; t.style.top = (y + 15) + 'px';

    let html = `<div>Cell #${state.hoveredCell.cell_id}</div>`;
    state.selectedFeatures.forEach(f => {
        const val = state.hoveredCell[f];
        const display = typeof val === 'number' ? val.toFixed(2) : 'N/A';
        html += `<div>${FEATURES[f].label}: ${display}</div>`;
    });
    t.innerHTML = html;
}

function renderMatrix() {
    const el = document.getElementById('correlation-heatmap');
    const feats = Array.from(state.selectedFeatures);
    el.style.gridTemplateColumns = `auto repeat(${feats.length}, 1fr)`;

    let html = `<div></div>` + feats.map(f => `<div style="text-align:center;color:var(--text-color);font-size:0.8rem;padding:0.5rem">${FEATURES[f].label}</div>`).join('');

    feats.forEach(rowF => {
        html += `<div style="text-align:right;color:var(--text-color);font-size:0.8rem;padding:0.5rem">${FEATURES[rowF].label}</div>`;
        feats.forEach(colF => {
            const corr = calculateCorrelation(rowF, colF);
            // Color Logic
            let color;
            if (corr >= 0) {
                const p = corr;
                color = `rgb(${Math.round(30 + (6 - 30) * p)}, ${Math.round(41 + (182 - 41) * p)}, ${Math.round(59 + (212 - 59) * p)})`;
            } else {
                const p = 1 + corr;
                color = `rgb(${Math.round(236 + (30 - 236) * p)}, ${Math.round(72 + (41 - 72) * p)}, ${Math.round(153 + (59 - 153) * p)})`;
            }
            html += `<div style="background:${color};padding:1rem;text-align:center;color:white;border:1px solid var(--border-color)">${corr.toFixed(2)}</div>`;
        });
    });
    el.innerHTML = html;
}

function calculateCorrelation(f1, f2) {
    if (f1 === f2) return 1.0;
    const cells = state.primaryData.cells;
    const n = cells.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

    for (const c of cells) {
        const x = c[f1];
        const y = c[f2];
        sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y;
    }
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
}
