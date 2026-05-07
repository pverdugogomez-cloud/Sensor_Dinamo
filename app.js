// --- Estado Global ---
let map = null;
let markers = {};
let currentChart = null;
let expandedChartInstance = null;
let equiposData = [];
let allHistoricalData = [];
let selectedEquipo = null;
let currentChartType = 'amperaje'; // 'amperaje' o 'potencia'
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
    btnChartVol: document.getElementById('btn-chart-vol'), // Aunque se llame Vol en HTML, lo usaremos para Potencia

    statAvg: document.getElementById('stat-avg'),
    statMax: document.getElementById('stat-max'),
    statUnit: document.getElementById('stat-unit'),
    statUnit2: document.getElementById('stat-unit-2'),

    dateFrom: document.getElementById('date-from'),
    dateTo: document.getElementById('date-to'),
    btnFilterToday: document.getElementById('btn-filter-today'),
    btnFilterYesterday: document.getElementById('btn-filter-yesterday'),
    btnFilterWeek: document.getElementById('btn-filter-week'),

    expandedModal: document.getElementById('expanded-modal'),
    btnCloseExpanded: document.getElementById('btn-close-expanded'),
    expandedTitle: document.getElementById('expanded-title'),
};

// Genera o extrae datos de consumo para el gráfico
function generateHistoricalData(type, equipoId) {
    const data = [];

    // Filtrar por equipo seleccionado
    let equipoHistory = allHistoricalData
        .filter(r => (r.dispositivo_id || r.id) === equipoId);

    // Aplicar filtros de fecha segura y con zona horaria local
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

    // Ordenamos explícitamente por fecha ascendente para el gráfico
    equipoHistory.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    let lastDate = null;
    equipoHistory.forEach(record => {
        const currentDate = new Date(record.fecha);

        // Si hay un salto mayor a 3 minutos (180,000 ms), insertar un salto nulo para romper la línea
        if (lastDate && (currentDate.getTime() - lastDate.getTime() > 180000)) {
            data.push({ x: new Date(lastDate.getTime() + 1000), y: null });
        }
        lastDate = currentDate;

        let val = 0;
        if (type === 'amperaje') {
            val = record.corriente != null ? Number(record.corriente).toFixed(1) : 0;
        } else {
            val = record.potencia_kw != null ? Number(record.potencia_kw).toFixed(1) : 0;
        }
        data.push({ x: currentDate, y: Number(val) });
    });

    // Si no hay filtro 'dateTo' estricto en el pasado, forzamos el gráfico hasta la hora actual con un dato vacío
    const isPastFilter = dom.dateTo && dom.dateTo.value && (new Date(dom.dateTo.value + 'T23:59:59') < new Date());
    if (!isPastFilter) {
        data.push({ x: new Date(), y: null });
    }

    return { labels: [], data };
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
        zoomControl: false // Movemos el control
    }).setView([-33.4489, -70.6693], 12);

    L.tileLayer(mapTiles, {
        attribution: mapAttribution,
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

function initEventListeners() {
    // Panel
    dom.btnCloseDetail.addEventListener('click', closeDetailPanel);

    // Gráficos
    dom.btnChartAmp.addEventListener('click', () => switchChartType('amperaje'));
    dom.btnChartVol.addEventListener('click', () => switchChartType('potencia'));

    // Expanded
    dom.btnExpand.addEventListener('click', openExpandedModal);
    dom.btnCloseExpanded.addEventListener('click', closeExpandedModal);

    // Filtros
    dom.dateFrom.addEventListener('change', () => { if (selectedEquipo) renderChart(currentChartType); });
    dom.dateTo.addEventListener('change', () => { if (selectedEquipo) renderChart(currentChartType); });

    // Botones Rápidos
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

        // Actualizar UI de botones
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

// --- Lógica de Google Sheets ---

async function fetchRealData() {
    if (!GOOGLE_APPS_SCRIPT_URL || GOOGLE_APPS_SCRIPT_URL === 'PON_TU_URL_AQUI') {
        dom.connStatus.textContent = 'Falta URL de Google Sheets';
        dom.connStatus.className = 'text-amber-500 font-medium';
        return;
    }

    try {
        const response = await fetch(GOOGLE_APPS_SCRIPT_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        // Mapear los datos asumiendo las claves de Google Apps Script
        const mappedData = data.map(item => {
            // Manejar posibles nombres de clave para la fecha que pueda devolver el JSON
            const dateVal = item['new Date()'] || item.fecha || item.Date || item.timestamp || new Date().toISOString();
            return {
                fecha: dateVal,
                dispositivo_id: item['data.dispositivo_id'] || item.dispositivo_id || 'Desconocido',
                corriente: parseFloat(item['data.corriente'] || item.corriente) || 0,
                potencia_kw: parseFloat(item['data.potencia_kw'] || item.potencia_kw) || 0,
                lat: parseFloat(item['data.lat'] || item.lat) || -33.4489,
                lon: parseFloat(item['data.lon'] || item.lon) || -70.6693,
                nombre: `Equipo ${item['data.dispositivo_id'] || item.dispositivo_id || 'Desconocido'}`
            };
        });

        if (mappedData && mappedData.length > 0) {
            allHistoricalData = mappedData;

            dom.connStatus.textContent = 'Conectado (Sheets)';
            dom.connStatus.className = 'text-emerald-500 font-medium';

            // Ordenar por fecha ascendente
            mappedData.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

            // Agrupar por dispositivo para obtener solo el último registro
            const latestDataMap = {};
            mappedData.forEach(row => {
                latestDataMap[row.dispositivo_id] = row;
            });

            loadEquipment(Object.values(latestDataMap));

            // Refrescar gráfico y panel si el panel está abierto
            if (selectedEquipo) {
                const stillExists = latestDataMap[selectedEquipo.id] || latestDataMap[selectedEquipo.dispositivo_id];
                if (stillExists) {
                    selectedEquipo = { ...selectedEquipo, ...stillExists, id: selectedEquipo.id, nombre: selectedEquipo.nombre };

                    const detailStatus = document.getElementById('detail-status');
                    if (detailStatus && selectedEquipo.estadoLabel) {
                        detailStatus.textContent = selectedEquipo.estadoLabel;
                        detailStatus.className = `${selectedEquipo.badgeColor.replace('bg-', 'text-')} ${selectedEquipo.badgeColor.replace('bg-', 'bg-').replace('500', '100')} px-2 py-0.5 rounded text-xs font-bold tracking-wider uppercase`;
                    }

                    renderChart(currentChartType);

                    if (!dom.expandedModal.classList.contains('hidden') && expandedChartInstance) {
                        const deviceIdentifier = selectedEquipo ? (selectedEquipo.dispositivo_id || selectedEquipo.id) : null;
                        const { data: expData } = generateHistoricalData(currentChartType, deviceIdentifier);
                        expandedChartInstance.data.datasets[0].data = expData;
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

// --- UI y Visualización ---

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

        let estado = 'ACTIVO';
        let badgeColor = 'bg-emerald-500';
        let shadowColor = 'shadow-emerald-500/30';
        let markerGlow = 'rgba(16,185,129,0.5)';

        if (minutosInactivo > 15) {
            estado = 'SIN SEÑAL';
            badgeColor = 'bg-slate-500';
            shadowColor = 'shadow-slate-500/30';
            markerGlow = 'rgba(100,116,139,0.5)';
        } else if (eq.corriente == 0) {
            estado = 'APAGADO';
            badgeColor = 'bg-red-500';
            shadowColor = 'shadow-red-500/30';
            markerGlow = 'rgba(239,68,68,0.5)';
        } else if (eq.corriente > 75) {
            estado = 'ALERTA MAX';
            badgeColor = 'bg-red-500';
            shadowColor = 'shadow-red-500/30';
            markerGlow = 'rgba(239,68,68,0.5)';
        }

        eq.estadoLabel = estado;
        eq.badgeColor = badgeColor;

        const el = document.createElement('div');
        el.className = 'group p-3 mb-2 rounded-xl bg-white border border-slate-200 hover:border-electric-500/50 cursor-pointer transition-all hover:shadow-lg hover:shadow-electric-900/10';
        el.innerHTML = `
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-mono text-slate-400 group-hover:text-electric-600 transition">${id}</span>
                <span class="w-2 h-2 rounded-full ${badgeColor} mt-1 shadow-[0_0_8px_rgba(0,0,0,0.2)] ${shadowColor}"></span>
            </div>
            <h3 class="text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition">${nombre}</h3>
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

    if (data.length > 0) {
        const group = new L.featureGroup(Object.values(markers));
        map.fitBounds(group.getBounds(), { padding: [50, 50] });
    }
}

function selectEquipo(eq) {
    selectedEquipo = eq;

    map.flyTo([eq.lat, eq.lng], 16, {
        duration: 1.5
    });

    setTimeout(() => {
        if (markers[eq.id]) markers[eq.id].openPopup();
    }, 1500);

    dom.detailId.textContent = `ID: ${eq.id}`;
    dom.detailName.textContent = eq.nombre;
    dom.detailLocation.textContent = `${eq.lat.toFixed(4)}, ${eq.lng.toFixed(4)}`;

    const detailStatus = document.getElementById('detail-status');
    if (detailStatus && eq.estadoLabel) {
        detailStatus.textContent = eq.estadoLabel;
        detailStatus.className = `${eq.badgeColor.replace('bg-', 'text-')} ${eq.badgeColor.replace('bg-', 'bg-').replace('500', '100')} px-2 py-0.5 rounded text-xs font-bold tracking-wider uppercase`;
    }

    renderChart(currentChartType);

    dom.detailPanel.classList.remove('-translate-x-[110%]', 'opacity-0', 'pointer-events-none');
}

function closeDetailPanel() {
    dom.detailPanel.classList.add('-translate-x-[110%]', 'opacity-0', 'pointer-events-none');
    selectedEquipo = null;
    map.closePopup();
}

function switchChartType(type) {
    currentChartType = type;

    if (type === 'amperaje') {
        dom.btnChartAmp.className = 'flex-1 py-1.5 text-sm font-medium rounded-md bg-white text-slate-900 shadow-sm border border-slate-200 transition';
        dom.btnChartVol.className = 'flex-1 py-1.5 text-sm font-medium rounded-md text-slate-500 hover:text-slate-900 transition';
    } else {
        dom.btnChartVol.className = 'flex-1 py-1.5 text-sm font-medium rounded-md bg-white text-slate-900 shadow-sm border border-slate-200 transition';
        dom.btnChartAmp.className = 'flex-1 py-1.5 text-sm font-medium rounded-md text-slate-500 hover:text-slate-900 transition';
    }

    if (selectedEquipo) {
        renderChart(type);
    }
}

function renderChart(type) {
    const ctx = document.getElementById('consumptionChart').getContext('2d');

    if (currentChart) {
        currentChart.destroy();
    }

    const deviceIdentifier = selectedEquipo ? (selectedEquipo.dispositivo_id || selectedEquipo.id) : null;
    const { data } = generateHistoricalData(type, deviceIdentifier);

    const validData = data.filter(item => item && item.y !== null).map(item => item.y);
    if (validData.length > 0) {
        const avg = validData.reduce((a, b) => a + b, 0) / validData.length;
        const max = Math.max(...validData);
        dom.statAvg.textContent = Number.isFinite(avg) ? avg.toFixed(1) : '0.0';
        dom.statMax.textContent = Number.isFinite(max) ? max.toFixed(1) : '0.0';
    } else {
        dom.statAvg.textContent = '--';
        dom.statMax.textContent = '--';
    }

    const unit = type === 'amperaje' ? 'A' : 'kW';
    dom.statUnit.textContent = unit;
    dom.statUnit2.textContent = unit;

    const color = type === 'amperaje' ? '#0ea5e9' : '#8b5cf6';
    const bgGradient = ctx.createLinearGradient(0, 0, 0, 200);
    bgGradient.addColorStop(0, type === 'amperaje' ? 'rgba(14, 165, 233, 0.2)' : 'rgba(139, 92, 246, 0.2)');
    bgGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

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
                ctx.font = '14px sans-serif';
                ctx.fillStyle = '#94a3b8';
                ctx.fillText('Sin lecturas en el periodo seleccionado', width / 2, height / 2);
                ctx.restore();
            }
        }
    };

    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = 'Inter';

    const titleType = type === 'amperaje' ? 'Amperaje' : 'Potencia';

    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: titleType,
                data: data,
                borderColor: color,
                borderWidth: 2,
                backgroundColor: bgGradient,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        title: function (tooltipItems) {
                            const item = tooltipItems[0];
                            const d = new Date(item.parsed.x);
                            const day = d.getDate().toString().padStart(2, '0');
                            const month = (d.getMonth() + 1).toString().padStart(2, '0');
                            const hours = d.getHours().toString().padStart(2, '0');
                            const mins = d.getMinutes().toString().padStart(2, '0');
                            return `Fecha: ${day}/${month} a las ${hours}:${mins} hrs`;
                        },
                        label: function (context) {
                            return `${titleType}: ${context.parsed.y} ${unit}`;
                        }
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
                    ticks: {
                        maxTicksLimit: 6,
                        autoSkip: true,
                        autoSkipPadding: 15
                    }
                },
                y: {
                    grid: { color: 'rgba(226, 232, 240, 1)', drawBorder: false },
                    beginAtZero: true
                }
            }
        },
        plugins: [noDataPlugin]
    });
}

function openExpandedModal() {
    if (!selectedEquipo) return;

    const titleType = currentChartType === 'amperaje' ? 'AMPERAJE' : 'POTENCIA';
    dom.expandedTitle.textContent = `- ${selectedEquipo.nombre} (${titleType})`;
    dom.expandedModal.classList.remove('hidden');
    dom.expandedModal.classList.add('flex');
    setTimeout(() => dom.expandedModal.classList.remove('opacity-0'), 50);

    const ctx = document.getElementById('expandedChart').getContext('2d');
    if (expandedChartInstance) expandedChartInstance.destroy();

    const deviceIdentifier = selectedEquipo ? (selectedEquipo.dispositivo_id || selectedEquipo.id) : null;
    const { data } = generateHistoricalData(currentChartType, deviceIdentifier);

    const color = currentChartType === 'amperaje' ? '#0ea5e9' : '#8b5cf6';
    const unit = currentChartType === 'amperaje' ? 'A' : 'kW';
    const title = currentChartType === 'amperaje' ? 'Amperaje' : 'Potencia';

    expandedChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Histórico',
                data: data,
                borderColor: color,
                borderWidth: 1.5,
                tension: 0.2,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHitRadius: 10,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        title: function (tooltipItems) {
                            const item = tooltipItems[0];
                            const d = new Date(item.parsed.x);
                            const day = d.getDate().toString().padStart(2, '0');
                            const month = (d.getMonth() + 1).toString().padStart(2, '0');
                            const hours = d.getHours().toString().padStart(2, '0');
                            const mins = d.getMinutes().toString().padStart(2, '0');
                            return `Fecha: ${day}/${month} a las ${hours}:${mins} hrs`;
                        },
                        label: function (context) {
                            return `${title}: ${context.parsed.y} ${unit}`;
                        }
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
                    ticks: {
                        color: '#64748b',
                        maxTicksLimit: 12,
                        autoSkip: true,
                        autoSkipPadding: 15
                    }
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
