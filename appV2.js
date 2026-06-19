// --- Estado Global ---
let map = null;
let markers = {};
let currentChart = null;
let expandedChartInstance = null;
let equiposData = [];
let allHistoricalData = [];
let selectedEquipo = null;
let currentChartType = 'amperaje'; // 'amperaje' o 'voltaje'
let fetchInterval = null;

// URL fija de Google Apps Script
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwW4HkNyEwxjoJqW8CgtmER6zbj01N6bnFDZMMAW1gfZudORRmv-YEpheyTzJvzGt7C/exec';

// Configuración de visualización de mapas para Leaflet (Google Satellite)
const mapTiles = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
const mapAttribution = '&copy; <a href="https://www.google.com/maps">Google Maps</a>';

// Elementos DOM
const dom = {
    connStatus: document.getElementById('connection-status'),
    equipmentList: document.getElementById('equipment-list'),

    detailPanel: document.getElementById('detail-panel'),
    btnCloseDetail: document.getElementById('btn-close-detail'),
    btnExpand: document.getElementById('btn-expand'),
    detailName: document.getElementById('detail-name'),
    detailId: document.getElementById('detail-id'),
    detailLocation: document.getElementById('detail-location'),

    btnChartAmp: document.getElementById('btn-chart-amp'),
    btnChartVol: document.getElementById('btn-chart-vol'),

    // DOM Lecturas Trifásicas
    statL1Amp: document.getElementById('stat-l1-amp'),
    statL2Amp: document.getElementById('stat-l2-amp'),
    statL3Amp: document.getElementById('stat-l3-amp'),
    statUnbalance: document.getElementById('stat-unbalance'),
    badgeUnbalance: document.getElementById('badge-unbalance'),

    statL1Vol: document.getElementById('stat-l1-vol'),
    statL2Vol: document.getElementById('stat-l2-vol'),
    statL3Vol: document.getElementById('stat-l3-vol'),

    statPower: document.getElementById('stat-power'),
    statFreq: document.getElementById('stat-freq'),
    statEnergy: document.getElementById('stat-energy'),

    dateFrom: document.getElementById('date-from'),
    dateTo: document.getElementById('date-to'),
    btnFilterToday: document.getElementById('btn-filter-today'),
    btnFilterYesterday: document.getElementById('btn-filter-yesterday'),
    btnFilterWeek: document.getElementById('btn-filter-week'),

    expandedModal: document.getElementById('expanded-modal'),
    btnCloseExpanded: document.getElementById('btn-close-expanded'),
    expandedTitle: document.getElementById('expanded-title'),
};

// Calcula el desbalance de fases (%)
function calcularDesbalance(i1, i2, i3) {
    const avg = (i1 + i2 + i3) / 3;
    if (avg === 0) return 0;
    const maxVal = Math.max(i1, i2, i3);
    const minVal = Math.min(i1, i2, i3);
    return ((maxVal - minVal) / avg) * 100;
}

// Genera o extrae datos de consumo para el gráfico trifásico
function generateHistoricalDataTrifasico(type, equipoId) {
    let equipoHistory = allHistoricalData.filter(r => r.dispositivo_id === equipoId);

    // Aplicar filtros de fecha
    if (dom.dateFrom && dom.dateFrom.value) {
        const fromDate = new Date(`${dom.dateFrom.value}T00:00:00`);
        if (!isNaN(fromDate)) {
            equipoHistory = equipoHistory.filter(r => new Date(r.fecha) >= fromDate);
        }
    }
    if (dom.dateTo && dom.dateTo.value) {
        const toDate = new Date(`${dom.dateTo.value}T23:59:59.999`);
        if (!isNaN(toDate)) {
            equipoHistory = equipoHistory.filter(r => new Date(r.fecha) <= toDate);
        }
    }

    // Ordenar por fecha ascendente
    equipoHistory.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    const l1Data = [];
    const l2Data = [];
    const l3Data = [];

    let lastDate = null;
    equipoHistory.forEach(record => {
        const currentDate = new Date(record.fecha);

        // Romper línea si hay saltos mayores a 3 minutos
        if (lastDate && (currentDate.getTime() - lastDate.getTime() > 180000)) {
            const gapTime = new Date(lastDate.getTime() + 1000);
            l1Data.push({ x: gapTime, y: null });
            l2Data.push({ x: gapTime, y: null });
            l3Data.push({ x: gapTime, y: null });
        }
        lastDate = currentDate;

        if (type === 'amperaje') {
            l1Data.push({ x: currentDate, y: Number(record.corriente_l1) });
            l2Data.push({ x: currentDate, y: Number(record.corriente_l2) });
            l3Data.push({ x: currentDate, y: Number(record.corriente_l3) });
        } else {
            l1Data.push({ x: currentDate, y: Number(record.voltaje_l1) });
            l2Data.push({ x: currentDate, y: Number(record.voltaje_l2) });
            l3Data.push({ x: currentDate, y: Number(record.voltaje_l3) });
        }
    });

    // Añadir timestamp actual con nulo para autocompletar si es hoy
    const isPastFilter = dom.dateTo && dom.dateTo.value && (new Date(dom.dateTo.value + 'T23:59:59') < new Date());
    if (!isPastFilter && l1Data.length > 0) {
        const now = new Date();
        l1Data.push({ x: now, y: null });
        l2Data.push({ x: now, y: null });
        l3Data.push({ x: now, y: null });
    }

    return { l1Data, l2Data, l3Data };
}

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();

    // Iniciar obtención de datos
    fetchRealData();

    // Iniciar polling de 10 segundos
    if (fetchInterval) clearInterval(fetchInterval);
    fetchInterval = setInterval(fetchRealData, 10000);
});

function initMap() {
    map = L.map('map', {
        zoomControl: false,
        maxZoom: 22
    }).setView([-33.4489, -70.6693], 12);

    L.tileLayer(mapTiles, {
        attribution: mapAttribution,
        maxZoom: 22,
        maxNativeZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

function initEventListeners() {
    dom.btnCloseDetail.addEventListener('click', closeDetailPanel);

    dom.btnChartAmp.addEventListener('click', () => switchChartType('amperaje'));
    dom.btnChartVol.addEventListener('click', () => switchChartType('voltaje'));

    dom.btnExpand.addEventListener('click', openExpandedModal);
    dom.btnCloseExpanded.addEventListener('click', closeExpandedModal);

    dom.dateFrom.addEventListener('change', () => { if (selectedEquipo) renderChart(currentChartType); });
    dom.dateTo.addEventListener('change', () => { if (selectedEquipo) renderChart(currentChartType); });

    const getLocalISODate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const setDates = (daysOffsetStart, daysOffsetEnd, btnId) => {
        const today = new Date();
        const dStart = new Date(today);
        dStart.setDate(today.getDate() - daysOffsetStart);
        const dEnd = new Date(today);
        dEnd.setDate(today.getDate() - daysOffsetEnd);

        dom.dateFrom.value = getLocalISODate(dStart);
        dom.dateTo.value = getLocalISODate(dEnd);

        ['btn-filter-today', 'btn-filter-yesterday', 'btn-filter-week'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.classList.remove('bg-electric-500', 'text-white');
                btn.classList.add('bg-slate-200', 'text-slate-700');
            }
        });
        if (btnId) {
            const activeBtn = document.getElementById(btnId);
            activeBtn.classList.remove('bg-slate-200', 'text-slate-700');
            activeBtn.classList.add('bg-electric-500', 'text-white');
        }

        if (selectedEquipo) renderChart(currentChartType);
    };

    dom.btnFilterToday.addEventListener('click', () => setDates(0, 0, 'btn-filter-today'));
    dom.btnFilterYesterday.addEventListener('click', () => setDates(1, 1, 'btn-filter-yesterday'));
    dom.btnFilterWeek.addEventListener('click', () => setDates(7, 0, 'btn-filter-week'));
}

// --- Fetch y Procesamiento de Datos ---
async function fetchRealData() {
    if (!GOOGLE_APPS_SCRIPT_URL) {
        dom.connStatus.textContent = 'Falta URL de Google Sheets';
        dom.connStatus.className = 'text-amber-500 font-medium';
        return;
    }

    try {
        const response = await fetch(GOOGLE_APPS_SCRIPT_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        // Mapear los datos de las tres fases
        const mappedData = data.map(item => {
            const dateVal = item['Fecha / Hora'] || item['new Date()'] || item.fecha || item.Date || item.timestamp || new Date().toISOString();
            const dispositivoId = item['Nombre del Equipo'] || item.dispositivo_id || 'PAC3200 Principal';

            // Lecturas trifásicas de corrientes y voltajes
            const c1 = parseFloat(item.Corriente_L1) || 0;
            const c2 = parseFloat(item.Corriente_L2) || 0;
            const c3 = parseFloat(item.Corriente_L3) || 0;

            const v1 = parseFloat(item.Voltaje_L1) || 0;
            const v2 = parseFloat(item.Voltaje_L2) || 0;
            const v3 = parseFloat(item.Voltaje_L3) || 0;

            const desbalanceVal = calcularDesbalance(c1, c2, c3);

            return {
                fecha: dateVal,
                dispositivo_id: dispositivoId,
                nombre: dispositivoId,
                
                corriente_l1: c1,
                corriente_l2: c2,
                corriente_l3: c3,
                corriente: (c1 + c2 + c3) / 3,
                desbalance: desbalanceVal,

                voltaje_l1: v1,
                voltaje_l2: v2,
                voltaje_l3: v3,

                potencia_kw: parseFloat(item.Potencia_Activa_Total || item.potencia_kw) || 0,
                frecuencia: parseFloat(item.Frecuencia || item.frecuencia) || 0,
                energia_activa: parseFloat(item.Energia_Activa || item.energia_activa) || 0,

                lat: parseFloat(item['Latitud '] || item.lat || -35.426236),
                lon: parseFloat(item.Longitud || item.lon || -71.61449)
            };
        });

        if (mappedData && mappedData.length > 0) {
            allHistoricalData = mappedData;

            dom.connStatus.textContent = 'Conectado (Sheets)';
            dom.connStatus.className = 'text-emerald-500 font-medium';

            // Ordenar por fecha ascendente
            mappedData.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

            // Agrupar por dispositivo para obtener el último registro
            const latestDataMap = {};
            mappedData.forEach(row => {
                latestDataMap[row.dispositivo_id] = row;
            });

            loadEquipment(Object.values(latestDataMap));

            // Refrescar paneles y gráficos del equipo activo
            if (selectedEquipo) {
                const stillExists = latestDataMap[selectedEquipo.dispositivo_id];
                if (stillExists) {
                    selectedEquipo = { ...selectedEquipo, ...stillExists };
                    updateRealTimeReadings(stillExists);
                    renderChart(currentChartType);

                    // Sincronizar gráfico extendido si está abierto
                    if (!dom.expandedModal.classList.contains('hidden') && expandedChartInstance) {
                        const { l1Data, l2Data, l3Data } = generateHistoricalDataTrifasico(currentChartType, selectedEquipo.dispositivo_id);
                        expandedChartInstance.data.datasets[0].data = l1Data;
                        expandedChartInstance.data.datasets[1].data = l2Data;
                        expandedChartInstance.data.datasets[2].data = l3Data;
                        expandedChartInstance.update('none');
                    }
                }
            }
        } else {
            dom.equipmentList.innerHTML = '<div class="p-4 text-slate-500 text-sm">Sin equipos registrados.</div>';
        }
    } catch (e) {
        console.error("Error fetching Sheets data:", e);
        dom.connStatus.textContent = 'Error de conexión';
        dom.connStatus.className = 'text-red-500 font-medium';
    }
}

function loadEquipment(data) {
    equiposData = data;
    dom.equipmentList.innerHTML = '';

    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};

    data.forEach((eq, idx) => {
        const lat = eq.lat;
        const lng = eq.lon;
        const id = eq.dispositivo_id;
        const nombre = eq.nombre;

        const fechaUltimoDato = new Date(eq.fecha);
        const ahora = new Date();
        const minutosInactivo = (ahora - fechaUltimoDato) / (1000 * 60);

        const hasOverload = eq.corriente > 75; // Límite nominal de corriente promedio
        const hasUnbalance = eq.desbalance > 8;
        const hasCriticalUnbalance = eq.desbalance > 15;

        let estado = 'ACTIVO';
        let badgeColor = 'bg-emerald-500';
        let shadowColor = 'shadow-emerald-500/30';
        let markerGlow = 'rgba(16,185,129,0.5)';

        // Lógica de alerta trifásica
        if (minutosInactivo > 15) {
            estado = 'SIN SEÑAL';
            badgeColor = 'bg-slate-500';
            shadowColor = 'shadow-slate-500/30';
            markerGlow = 'rgba(100,116,139,0.5)';
        } else if (eq.corriente_l1 === 0 && eq.corriente_l2 === 0 && eq.corriente_l3 === 0) {
            estado = 'APAGADO';
            badgeColor = 'bg-slate-400';
            shadowColor = 'shadow-slate-400/30';
            markerGlow = 'rgba(148,163,184,0.5)';
        } else {
            if (hasOverload && hasCriticalUnbalance) {
                estado = 'SOBRECARGA Y DESBALANCE';
                badgeColor = 'bg-red-500';
                shadowColor = 'shadow-red-500/30';
                markerGlow = 'rgba(239,68,68,0.5)';
            } else if (hasOverload && !hasUnbalance) {
                estado = 'SOBRECARGA MECÁNICA';
                badgeColor = 'bg-red-500';
                shadowColor = 'shadow-red-500/30';
                markerGlow = 'rgba(239,68,68,0.5)';
            } else if (hasCriticalUnbalance) {
                estado = 'CRÍTICO: DESBALANCE';
                badgeColor = 'bg-red-500';
                shadowColor = 'shadow-red-500/30';
                markerGlow = 'rgba(239,68,68,0.5)';
            } else if (hasUnbalance) {
                estado = 'ALERTA: DESBALANCE';
                badgeColor = 'bg-amber-500';
                shadowColor = 'shadow-amber-500/30';
                markerGlow = 'rgba(245,158,11,0.5)';
            } else {
                estado = 'ACTIVO';
                badgeColor = 'bg-emerald-500';
                shadowColor = 'shadow-emerald-500/30';
                markerGlow = 'rgba(16,185,129,0.5)';
            }
        }

        eq.estadoLabel = estado;
        eq.badgeColor = badgeColor;

        // Determinar clases de color y animación para testigos (Gauges de auto) en la tarjeta
        let lightningColorClass = 'text-slate-300';
        let lightningAnimClass = '';
        if (hasCriticalUnbalance) {
            lightningColorClass = 'text-red-500 font-bold';
            lightningAnimClass = 'animate-pulse';
        } else if (hasUnbalance) {
            lightningColorClass = 'text-amber-500 font-bold';
        }

        let warningColorClass = 'text-slate-300';
        let warningAnimClass = '';
        if (hasOverload) {
            warningColorClass = 'text-red-500 font-bold';
            warningAnimClass = 'animate-pulse';
        }

        const el = document.createElement('div');
        el.className = 'group p-3 mb-2 rounded-xl bg-white border border-slate-200 hover:border-electric-500/50 cursor-pointer transition-all hover:shadow-lg hover:shadow-electric-900/10';
        el.innerHTML = `
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-mono text-slate-400 group-hover:text-electric-600 transition truncate max-w-[65%]">${id}</span>
                <div class="flex items-center gap-1.5 mt-0.5">
                    <!-- Testigo Eléctrico (Desbalance) -->
                    <i class="ph ph-lightning text-[13px] ${lightningColorClass} ${lightningAnimClass}" title="Testigo Eléctrico (Desbalance): ${eq.desbalance.toFixed(1)}%"></i>
                    <!-- Testigo Mecánico (Esfuerzo/Sobrecarga) -->
                    <i class="ph ph-wrench text-[13px] ${warningColorClass} ${warningAnimClass}" title="Testigo Mecánico (Esfuerzo): ${eq.corriente.toFixed(1)}A"></i>
                    <!-- Punto de Estado -->
                    <span class="w-2.5 h-2.5 rounded-full ${badgeColor} shadow-[0_0_8px_rgba(0,0,0,0.2)] ${shadowColor}"></span>
                </div>
            </div>
            <h3 class="text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition truncate">${nombre}</h3>
            <div class="flex gap-2 mt-1.5 text-[10px] text-slate-400">
                <span>Prom: ${eq.corriente.toFixed(2)}A</span>
                <span>•</span>
                <span>Desbal: ${eq.desbalance.toFixed(1)}%</span>
            </div>
        `;
        el.addEventListener('click', () => selectEquipo({ ...eq, id, nombre, lat, lng }));
        dom.equipmentList.appendChild(el);

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="w-4 h-4 ${badgeColor} rounded-full border-2 border-white shadow-[0_0_15px_${markerGlow}]"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
        marker.bindPopup(`<b class="font-sans text-slate-900">${nombre}</b><br><span class="text-xs text-slate-500 font-mono">${id}</span>`);
        marker.on('click', () => selectEquipo({ ...eq, id, nombre, lat, lng }));
        markers[id] = marker;
    });

    if (data.length > 0 && !selectedEquipo) {
        const group = new L.featureGroup(Object.values(markers));
        map.fitBounds(group.getBounds(), { padding: [50, 50] });
    }
}

function selectEquipo(eq) {
    selectedEquipo = eq;

    // Mantener el zoom actual si el usuario ya está muy cerca, de lo contrario hacer zoom in a nivel 19
    const targetZoom = map.getZoom() > 16 ? map.getZoom() : 19;

    map.flyTo([eq.lat, eq.lng], targetZoom, {
        duration: 1.5
    });

    setTimeout(() => {
        if (markers[eq.id]) markers[eq.id].openPopup();
    }, 1500);

    dom.detailId.textContent = `ID: ${eq.id}`;
    dom.detailName.textContent = eq.nombre;
    dom.detailLocation.textContent = `${eq.lat.toFixed(6)}, ${eq.lng.toFixed(6)}`;

    updateRealTimeReadings(eq);
    renderChart(currentChartType);

    dom.detailPanel.classList.remove('-translate-x-[120%]', 'md:-translate-x-[110%]', 'opacity-0', 'pointer-events-none');
}

function updateRealTimeReadings(eq) {
    const detailStatus = document.getElementById('detail-status');
    if (detailStatus && eq.estadoLabel) {
        detailStatus.textContent = eq.estadoLabel;
        detailStatus.className = `${eq.badgeColor.replace('bg-', 'text-')} ${eq.badgeColor.replace('bg-', 'bg-').replace('500', '100')} px-2 py-0.5 rounded text-xs font-bold tracking-wider uppercase`;
    }

    // Corrientes L1, L2, L3
    dom.statL1Amp.textContent = eq.corriente_l1.toFixed(2);
    dom.statL2Amp.textContent = eq.corriente_l2.toFixed(2);
    dom.statL3Amp.textContent = eq.corriente_l3.toFixed(2);

    // Desbalance
    dom.statUnbalance.textContent = eq.desbalance.toFixed(1);
    if (eq.desbalance > 15) {
        dom.badgeUnbalance.className = "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-red-100 text-red-700 animate-pulse";
    } else if (eq.desbalance > 8) {
        dom.badgeUnbalance.className = "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-amber-100 text-amber-700";
    } else {
        dom.badgeUnbalance.className = "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-emerald-100 text-emerald-700";
    }

    // Voltajes L1, L2, L3
    dom.statL1Vol.textContent = eq.voltaje_l1.toFixed(1);
    dom.statL2Vol.textContent = eq.voltaje_l2.toFixed(1);
    dom.statL3Vol.textContent = eq.voltaje_l3.toFixed(1);

    // Parámetros de Operación
    dom.statPower.textContent = eq.potencia_kw.toFixed(2);
    dom.statFreq.textContent = eq.frecuencia.toFixed(1);
    dom.statEnergy.textContent = eq.energia_activa.toFixed(2);

    // Actualizar tacómetros visuales (velocímetros)
    updateGauge('gauge-amp-arc', 'gauge-amp-text', eq.corriente, 100, false);
    updateGauge('gauge-desbal-arc', 'gauge-desbal-text', eq.desbalance, 30, true);
}

// Función auxiliar para actualizar relojes SVG (Tacómetros)
function updateGauge(arcId, textId, value, maxVal, isPercent) {
    const arc = document.getElementById(arcId);
    const text = document.getElementById(textId);
    if (!arc || !text) return;

    // Calcular porcentaje de llenado (de 0 a 1)
    const percentage = Math.min(Math.max(value / maxVal, 0), 1);
    
    // El stroke-dasharray del arco es 110. 
    // offset = 110 * (1 - percentage)
    const offset = 110 * (1 - percentage);
    arc.setAttribute('stroke-dashoffset', offset);

    // Color del arco según severidad
    let color = '#10b981'; // Verde por defecto (sano)
    if (isPercent) {
        if (value > 15) {
            color = '#ef4444'; // Rojo (Crítico)
        } else if (value > 8) {
            color = '#f59e0b'; // Amarillo (Alerta)
        } else {
            color = '#10b981'; // Verde
        }
    } else {
        // Amperaje
        if (value > 75) {
            color = '#ef4444'; // Rojo (Sobrecarga)
        } else if (value > 50) {
            color = '#f59e0b'; // Amarillo (Esfuerzo medio)
        } else {
            color = '#0ea5e9'; // Azul (Carga normal)
        }
    }
    arc.setAttribute('stroke', color);
    
    // Texto interior
    text.textContent = value.toFixed(1) + (isPercent ? '%' : 'A');
}

function closeDetailPanel() {
    dom.detailPanel.classList.add('-translate-x-[120%]', 'md:-translate-x-[110%]', 'opacity-0', 'pointer-events-none');
    selectedEquipo = null;
    map.closePopup();
}

function switchChartType(type) {
    currentChartType = type;

    if (type === 'amperaje') {
        dom.btnChartAmp.className = 'flex-1 py-1.5 text-xs font-medium rounded-md bg-white text-slate-900 shadow-sm border border-slate-200 transition';
        dom.btnChartVol.className = 'flex-1 py-1.5 text-xs font-medium rounded-md text-slate-500 hover:text-slate-900 transition';
    } else {
        dom.btnChartVol.className = 'flex-1 py-1.5 text-xs font-medium rounded-md bg-white text-slate-900 shadow-sm border border-slate-200 transition';
        dom.btnChartAmp.className = 'flex-1 py-1.5 text-xs font-medium rounded-md text-slate-500 hover:text-slate-900 transition';
    }

    if (selectedEquipo) {
        renderChart(type);
    }
}

function renderChart(type) {
    const ctx = document.getElementById('consumptionChart').getContext('2d');
    const { l1Data, l2Data, l3Data } = generateHistoricalDataTrifasico(type, selectedEquipo.dispositivo_id);

    // Si el gráfico ya existe, es del mismo tipo y del mismo equipo, solo actualizamos los datos sin destruir para evitar el parpadeo
    if (currentChart && currentChart.chartType === type && currentChart.dispositivoId === selectedEquipo.dispositivo_id) {
        currentChart.data.datasets[0].data = l1Data;
        currentChart.data.datasets[1].data = l2Data;
        currentChart.data.datasets[2].data = l3Data;
        currentChart.update('none'); // Desplazamiento suave sin pestañeo
        return;
    }

    if (currentChart) {
        currentChart.destroy();
    }

    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = 'Inter';

    const titleType = type === 'amperaje' ? 'Amperaje' : 'Voltaje';
    const unit = type === 'amperaje' ? 'A' : 'V';

    const noDataPlugin = {
        id: 'noData',
        afterDraw: (chart) => {
            if (chart.data.datasets[0].data.length === 0) {
                const ctx = chart.ctx;
                const width = chart.width;
                const height = chart.height;
                chart.clear();

                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = '13px sans-serif';
                ctx.fillStyle = '#94a3b8';
                ctx.fillText('Sin lecturas en el periodo seleccionado', width / 2, height / 2);
                ctx.restore();
            }
        }
    };

    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Fase L1',
                    data: l1Data,
                    borderColor: '#0ea5e9', // Azul
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 15,
                    fill: false,
                    spanGaps: false
                },
                {
                    label: 'Fase L2',
                    data: l2Data,
                    borderColor: '#10b981', // Verde
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 15,
                    fill: false,
                    spanGaps: false
                },
                {
                    label: 'Fase L3',
                    data: l3Data,
                    borderColor: '#f59e0b', // Naranja
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 15,
                    fill: false,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true,
            },
            plugins: {
                legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 8,
                    callbacks: {
                        title: function (tooltipItems) {
                            const d = new Date(tooltipItems[0].parsed.x);
                            const day = d.getDate().toString().padStart(2, '0');
                            const month = (d.getMonth() + 1).toString().padStart(2, '0');
                            const hours = d.getHours().toString().padStart(2, '0');
                            const mins = d.getMinutes().toString().padStart(2, '0');
                            return `Lectura: ${day}/${month} a las ${hours}:${mins} hrs`;
                        },
                        label: function (context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} ${unit}`;
                        }
                    }
                },
                zoom: {
                    limits: {
                        x: {
                            minRange: 1000 * 60 // Rango mínimo: 1 minuto
                        }
                    },
                    pan: {
                        enabled: true,
                        mode: 'xy',
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'xy',
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        tooltipFormat: 'dd/MM HH:mm',
                        displayFormats: {
                            minute: 'HH:mm',
                            hour: 'HH:mm',
                            day: 'dd/MM'
                        }
                    },
                    grid: { display: false, drawBorder: false },
                    ticks: { maxTicksLimit: 5, font: { size: 9 } }
                },
                y: {
                    grid: { color: 'rgba(226, 232, 240, 1)', drawBorder: false },
                    beginAtZero: true,
                    ticks: { font: { size: 9 } }
                }
            }
        },
        plugins: [noDataPlugin]
    });
    currentChart.chartType = type;
    currentChart.dispositivoId = selectedEquipo.dispositivo_id;
}

function openExpandedModal() {
    if (!selectedEquipo) return;

    const titleType = currentChartType === 'amperaje' ? 'AMPERAJE TRÍFASICO' : 'VOLTAJE TRÍFASICO';
    dom.expandedTitle.textContent = `- ${selectedEquipo.nombre} (${titleType})`;
    dom.expandedModal.classList.remove('hidden');
    dom.expandedModal.classList.add('flex');
    setTimeout(() => dom.expandedModal.classList.remove('opacity-0'), 50);

    const ctx = document.getElementById('expandedChart').getContext('2d');
    if (expandedChartInstance) expandedChartInstance.destroy();

    const { l1Data, l2Data, l3Data } = generateHistoricalDataTrifasico(currentChartType, selectedEquipo.dispositivo_id);
    const unit = currentChartType === 'amperaje' ? 'A' : 'V';

    expandedChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Fase L1',
                    data: l1Data,
                    borderColor: '#0ea5e9',
                    borderWidth: 1.5,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 15,
                    fill: false,
                    spanGaps: false
                },
                {
                    label: 'Fase L2',
                    data: l2Data,
                    borderColor: '#10b981',
                    borderWidth: 1.5,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 15,
                    fill: false,
                    spanGaps: false
                },
                {
                    label: 'Fase L3',
                    data: l3Data,
                    borderColor: '#f59e0b',
                    borderWidth: 1.5,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 15,
                    fill: false,
                    spanGaps: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true,
            },
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        title: function (tooltipItems) {
                            const d = new Date(tooltipItems[0].parsed.x);
                            const day = d.getDate().toString().padStart(2, '0');
                            const month = (d.getMonth() + 1).toString().padStart(2, '0');
                            const hours = d.getHours().toString().padStart(2, '0');
                            const mins = d.getMinutes().toString().padStart(2, '0');
                            return `Fecha: ${day}/${month} a las ${hours}:${mins} hrs`;
                        },
                        label: function (context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} ${unit}`;
                        }
                    }
                },
                zoom: {
                    limits: {
                        x: {
                            minRange: 1000 * 60 // Rango mínimo: 1 minuto
                        }
                    },
                    pan: {
                        enabled: true,
                        mode: 'xy',
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'xy',
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        tooltipFormat: 'dd/MM HH:mm',
                        displayFormats: {
                            minute: 'HH:mm',
                            hour: 'HH:mm',
                            day: 'dd/MM'
                        }
                    },
                    display: true,
                    grid: { display: false },
                    ticks: { color: '#64748b', maxTicksLimit: 10 }
                },
                y: { grid: { color: 'rgba(226, 232, 240, 1)' }, beginAtZero: true }
            }
        }
    });
}

function closeExpandedModal() {
    dom.expandedModal.classList.add('opacity-0');
    setTimeout(() => {
        dom.expandedModal.classList.remove('flex');
        dom.expandedModal.classList.add('hidden');
    }, 300);
}
