// Global state for lab view
let labSystemData = {
	summary: { cpu: 0, memory: 0, disk: 0, network: 0 },
	health: 'checking',
	lastUpdated: null,
	peakValues: { cpu: 0, memory: 0 }
};

async function fetchJSON(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error('Request failed');
	return await res.json();
}

// Theme management
function toggleTheme() {
	const currentTheme = document.documentElement.getAttribute('data-theme');
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
	document.documentElement.setAttribute('data-theme', newTheme);
	localStorage.setItem('theme', newTheme);
	
	const themeIcon = document.getElementById('themeIcon');
	themeIcon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// Initialize theme
function initTheme() {
	const savedTheme = localStorage.getItem('theme') || 'light';
	document.documentElement.setAttribute('data-theme', savedTheme);
	const themeIcon = document.getElementById('themeIcon');
	themeIcon.className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// Update last updated timestamp
function updateLastUpdated() {
	const now = new Date();
	const timeString = now.toLocaleTimeString();
	document.getElementById('lastUpdated').textContent = `Last updated: ${timeString}`;
	labSystemData.lastUpdated = now;
}

// Update system summary for lab view
async function updateLabSummary(labId) {
	try {
		const [series, avg] = await Promise.all([
			fetchJSON(`/api/lab/series?labId=${encodeURIComponent(labId)}&limit=1`),
			fetchJSON(`/api/avg/lab?labId=${encodeURIComponent(labId)}&limit=100`)
		]);
		
		if (avg) {
			labSystemData.summary = {
				cpu: avg.cpuLoadPercent,
				memory: avg.memUsedPercent,
				disk: avg.diskUsedPercent,
				network: avg.netUsedPercent
			};
			
			// Update summary bar
			document.getElementById('summaryCpu').textContent = `${avg.cpuLoadPercent.toFixed(1)}%`;
			document.getElementById('summaryMemory').textContent = `${avg.memUsedPercent.toFixed(1)}%`;
			document.getElementById('summaryDisk').textContent = `${avg.diskUsedPercent.toFixed(1)}%`;
			const netValue = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
			document.getElementById('summaryNetwork').textContent = netValue;
			
			// Update peak values
			labSystemData.peakValues.cpu = Math.max(labSystemData.peakValues.cpu, avg.cpuLoadPercent);
			labSystemData.peakValues.memory = Math.max(labSystemData.peakValues.memory, avg.memUsedPercent);
			
			// Update uptime
			const uptimeElement = document.getElementById('summaryUptime');
			if (uptimeElement) {
				if (avg.uptimeSeconds) {
					const hours = Math.floor(avg.uptimeSeconds / 3600);
					const minutes = Math.floor((avg.uptimeSeconds % 3600) / 60);
					const seconds = avg.uptimeSeconds % 60;
					if (hours > 0) {
						uptimeElement.textContent = `${hours}h ${minutes}m`;
					} else if (minutes > 0) {
						uptimeElement.textContent = `${minutes}m ${seconds}s`;
					} else {
						uptimeElement.textContent = `${seconds}s`;
					}
				} else {
					const now = new Date();
					const startTime = labSystemData.lastUpdated || now;
					const diff = now - startTime;
					const minutes = Math.floor(diff / 60000);
					uptimeElement.textContent = `${minutes}m`;
				}
			}
		}
	} catch (error) {
		console.error('Error updating lab summary:', error);
	}
}

function getQueryParam(name) {
	const params = new URLSearchParams(location.search);
	return params.get(name);
}

function highlightSelectedLab(labId) {
	document.querySelectorAll('.lab-link').forEach(link => {
		if (link.href.includes(`labId=${encodeURIComponent(labId)}`)) {
			link.classList.add('active');
		} else {
			link.classList.remove('active');
		}
	});
}

async function loadLabsSidebar(selectedLabId) {
	const labs = await fetchJSON('/api/labs');
	const ul = document.getElementById('labList');
	if (!ul) return;
	ul.innerHTML = '';
	if (!labs.length) {
		ul.innerHTML = '<li style="color:#888;padding:8px;">No labs found</li>';
		return;
	}
	labs.forEach((l) => {
		const li = document.createElement('li');
		li.innerHTML = `<a class="lab-link${l===selectedLabId?' active':''}" href="/lab.html?labId=${encodeURIComponent(l)}">
			<div class="lab-icon">${l.slice(0,2).toUpperCase()}</div>
			<div class="lab-text"><span class="lab-name">${l}</span><span class="lab-sub">View PCs</span></div>
			<div class="lab-cta">Open ›</div>
		</a>`;
		ul.appendChild(li);
	});
	highlightSelectedLab(selectedLabId);
}

function getQueryParam(name) {
	const params = new URLSearchParams(location.search);
	return params.get(name);
}

function formatAvg(avg) {
	if (!avg) return 'No data';
	const netValue = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
	return `CPU ${avg.cpuLoadPercent.toFixed(1)}% · Mem ${avg.memUsedPercent.toFixed(1)}% · Disk ${avg.diskUsedPercent.toFixed(1)}% · Net ${netValue}`;
}

let charts = {};
function ensureChart(key, ctx, labels, data, color, label) {
	if (charts[key]) {
		charts[key].data.labels = labels;
		charts[key].data.datasets[0].data = data;
		charts[key].update();
		return charts[key];
	}
	const gradient = ctx.createLinearGradient(0, 0, 0, 140);
	gradient.addColorStop(0, color + '66');
	gradient.addColorStop(1, color + '00');
	charts[key] = new Chart(ctx, {
		type: 'line',
		data: { labels, datasets: [{ label, data, borderColor: color, backgroundColor: gradient, pointRadius: 0, borderWidth: 2, tension: 0.35, fill: true }] },
		options: {
			responsive: true,
			plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
			scales: {
				x: { display: false, grid: { display: false } },
				y: { display: false, grid: { color: 'rgba(203,213,225,.3)', drawBorder: false } }
			},
			elements: { line: { borderCapStyle: 'round' } }
		}
	});
	return charts[key];
}


async function loadLab() {
	const labId = getQueryParam('labId') || 'lab-1';
	document.getElementById('labTitle').textContent = `Lab: ${labId}`;
	await loadLabsSidebar(labId);
	let pcs = [];
	try {
		pcs = await fetchJSON(`/api/labs/${encodeURIComponent(labId)}/pcs`);
	} catch (e) {
		pcs = [];
	}
	const grid = document.getElementById('pcGrid');
	grid.innerHTML = '';
	if (!pcs.length) {
		grid.innerHTML = '<div style="color:#888;padding:16px;">No PCs found in this lab.</div>';
	}
	pcs.forEach((pcId) => {
		const card = document.createElement('div');
		card.className = 'pc-card';
		card.innerHTML = `<div class="pc-header"><div class="pc-id"><span class="dot"></span><strong>${pcId}</strong></div></div>`;
		card.addEventListener('click', () => loadPcStats(labId, pcId));
		grid.appendChild(card);
	});
	await loadLabOverview(labId);
}


let selectedPcId = null;
let pcRefreshInterval = null;

async function loadPcStats(labId, pcId) {
    // Clear any existing refresh interval
    if (pcRefreshInterval) {
        clearInterval(pcRefreshInterval);
        pcRefreshInterval = null;
    }
    
    selectedPcId = pcId;
    const limit = 120;
    let series = [], avg = null;
    try {
        [series, avg] = await Promise.all([
            fetchJSON(`/api/series?labId=${encodeURIComponent(labId)}&pcId=${encodeURIComponent(pcId)}&limit=${limit}`),
            fetchJSON(`/api/avg/pc?labId=${encodeURIComponent(labId)}&pcId=${encodeURIComponent(pcId)}&limit=${limit}`)
        ]);
    } catch (e) {
        series = [];
        avg = null;
    }
    const stats = document.getElementById('pcStats');
    if (!series || series.length === 0) {
        stats.style.display = 'none';
        return;
    }
    stats.style.display = 'block';
    document.getElementById('pcTitle').textContent = `PC: ${pcId}`;
    document.getElementById('pcAvg').textContent = formatAvg(avg);

    // Update chart values
    if (avg) {
        document.getElementById('pcCpuValue').textContent = `${avg.cpuLoadPercent.toFixed(1)}%`;
        document.getElementById('pcMemValue').textContent = `${avg.memUsedPercent.toFixed(1)}%`;
        document.getElementById('pcDiskValue').textContent = `${avg.diskUsedPercent.toFixed(1)}%`;
        const netValue = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
        document.getElementById('pcNetValue').textContent = netValue;
    }

    const toNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const labels = series.map(d => new Date(d.timestamp).toLocaleTimeString());
    ensureChart('pcCpu', document.getElementById('pcCpu').getContext('2d'), labels, series.map(d=>toNum(d.cpuLoadPercent)), '#ef4444', 'CPU %');
    ensureChart('pcMem', document.getElementById('pcMem').getContext('2d'), labels, series.map(d=>toNum(d.memUsedPercent)), '#22c55e', 'Mem %');
    ensureChart('pcDisk', document.getElementById('pcDisk').getContext('2d'), labels, series.map(d=>toNum(d.diskUsedPercent)), '#3b82f6', 'Disk %');
    ensureChart('pcNet', document.getElementById('pcNet').getContext('2d'), labels, series.map(d=>toNum(d.netUsedPercent)), '#06b6d4', 'Net %');

    // Show top processes from the most recent sample
    const latest = series[series.length - 1];
    const procContainerId = 'pcProcesses';
    let procContainer = document.getElementById(procContainerId);
    
	// (Interval will be started after procContainer / itemsDiv exist)
    if (!procContainer) {
        procContainer = document.createElement('div');
        procContainer.id = procContainerId;
        procContainer.className = 'process-list card';
        procContainer.style.marginTop = '16px';
        procContainer.innerHTML = `<div class="card-header"><h4>Top Processes</h4></div><div class="process-items"></div>`;
        stats.appendChild(procContainer);
    }

	const itemsDiv = procContainer.querySelector('.process-items');
    itemsDiv.innerHTML = '';
    const processes = (latest && latest.processes) ? latest.processes : [];
    if (!processes.length) {
        itemsDiv.innerHTML = '<div style="padding:12px;color:#888;">No process data available</div>';
    } else {
        processes.slice(0,5).forEach(p => {
            const el = document.createElement('div');
            el.className = 'process-item';
            el.innerHTML = `<div class="process-name">${escapeHtml(p.name||p.command||p.pid)}</div><div class="process-stats">CPU ${Number(p.cpu||0).toFixed(1)}% · Mem ${Number(p.mem||0).toFixed(1)}%</div>`;
            itemsDiv.appendChild(el);
        });
    }

	// Note: pcRefreshInterval already started above to update in-place. It will be
	// cleared when another PC is selected or when loadPcStats is called again.

	// Start the in-place interval updater now that itemsDiv exists
	pcRefreshInterval = setInterval(async () => {
		if (selectedPcId !== pcId) return;
		try {
			const [newSeries, newAvg] = await Promise.all([
				fetchJSON(`/api/series?labId=${encodeURIComponent(labId)}&pcId=${encodeURIComponent(pcId)}&limit=${limit}`),
				fetchJSON(`/api/avg/pc?labId=${encodeURIComponent(labId)}&pcId=${encodeURIComponent(pcId)}&limit=${limit}`)
			]);
			if (!newSeries || newSeries.length === 0) return;

			series = newSeries;
			avg = newAvg;

			if (avg) {
				const cpuEl = document.getElementById('pcCpuValue');
				const memEl = document.getElementById('pcMemValue');
				const diskEl = document.getElementById('pcDiskValue');
				const netEl = document.getElementById('pcNetValue');
				if (cpuEl) cpuEl.textContent = `${avg.cpuLoadPercent.toFixed(1)}%`;
				if (memEl) memEl.textContent = `${avg.memUsedPercent.toFixed(1)}%`;
				if (diskEl) diskEl.textContent = `${avg.diskUsedPercent.toFixed(1)}%`;
				if (netEl) netEl.textContent = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
			}

			const labelsNew = series.map(d => new Date(d.timestamp).toLocaleTimeString());
			updateChartData('pcCpu', labelsNew, series.map(d => toNum(d.cpuLoadPercent)));
			updateChartData('pcMem', labelsNew, series.map(d => toNum(d.memUsedPercent)));
			updateChartData('pcDisk', labelsNew, series.map(d => toNum(d.diskUsedPercent)));
			updateChartData('pcNet', labelsNew, series.map(d => toNum(d.netUsedPercent)));

			const latest = series[series.length - 1];
			const processes = (latest && latest.processes) ? latest.processes : [];
			itemsDiv.innerHTML = '';
			if (!processes.length) {
				itemsDiv.innerHTML = '<div style="padding:12px;color:#888;">No process data available</div>';
			} else {
				processes.slice(0,5).forEach(p => {
					const el = document.createElement('div');
					el.className = 'process-item';
					el.innerHTML = `<div class="process-name">${escapeHtml(p.name||p.command||p.pid)}</div><div class="process-stats">CPU ${Number(p.cpu||0).toFixed(1)}% · Mem ${Number(p.mem||0).toFixed(1)}%</div>`;
					itemsDiv.appendChild(el);
				});
			}
		} catch (e) {
			console.error('Error updating PC stats:', e);
		}
	}, 3000);
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


// Removed placeholder generators; only live data


async function loadLabOverview(labId) {
	const limit = 200;
	let series = [], avg = null;
	try {
		[series, avg] = await Promise.all([
			fetchJSON(`/api/lab/series?labId=${encodeURIComponent(labId)}&limit=${limit}`),
			fetchJSON(`/api/avg/lab?labId=${encodeURIComponent(labId)}&limit=${limit}`),
		]);
	} catch (e) {
		series = [];
		avg = null;
	}
	const labOverviewEl = document.getElementById('labOverview');
	const chartsGrid = labOverviewEl.querySelector('.charts-grid');
	const noDataId = 'labNoDataMessage';
	// Remove any previous no-data message
	const prevMsg = document.getElementById(noDataId);
	if (prevMsg) prevMsg.remove();

	if (!series || series.length === 0) {
		// Hide charts (do not replace innerHTML — that would recreate canvases and break Chart.js)
		if (chartsGrid) chartsGrid.style.display = 'none';
		// Show a stable no-data message element
		const msg = document.createElement('div');
		msg.id = noDataId;
		msg.style.color = '#888';
		msg.style.padding = '16px';
		msg.textContent = 'No stats found for this lab.';
		labOverviewEl.appendChild(msg);
		return;
	}
	// Ensure charts are visible when data exists
	if (chartsGrid) chartsGrid.style.display = '';
    const toNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const labels = series.map(d => new Date(d.timestamp).toLocaleTimeString());
    
	// Update chart values
	if (avg) {
		document.getElementById('labCpuValue').textContent = `${avg.cpuLoadPercent.toFixed(1)}%`;
		document.getElementById('labMemValue').textContent = `${avg.memUsedPercent.toFixed(1)}%`;
		document.getElementById('labDiskValue').textContent = `${avg.diskUsedPercent.toFixed(1)}%`;
		const netValue = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
		document.getElementById('labNetValue').textContent = netValue;
	}
    
    ensureChart('labCpu', document.getElementById('labCpu').getContext('2d'), labels, series.map(d=>toNum(d.cpuLoadPercent)), '#ef4444', 'CPU %');
    ensureChart('labMem', document.getElementById('labMem').getContext('2d'), labels, series.map(d=>toNum(d.memUsedPercent)), '#22c55e', 'Mem %');
    ensureChart('labDisk', document.getElementById('labDisk').getContext('2d'), labels, series.map(d=>toNum(d.diskUsedPercent)), '#3b82f6', 'Disk %');
    ensureChart('labNet', document.getElementById('labNet').getContext('2d'), labels, series.map(d=>toNum(d.netUsedPercent)), '#06b6d4', 'Net %');
	if (avg) document.getElementById('labAvg').textContent = formatAvg(avg);

	// Render aggregated top processes for the lab if provided
	// Remove any existing lab-processes container
	const existing = document.getElementById('labProcesses');
	if (existing) existing.remove();
	if (avg && avg.processes) {
		const procCard = document.createElement('div');
		procCard.id = 'labProcesses';
		procCard.className = 'card lab-processes';
		procCard.style.marginTop = '16px';
		let html = `<div class="card-header"><h4>Top Processes (Lab)</h4></div>`;
		html += '<div class="process-rows">';
		if (Array.isArray(avg.processes.topByCpu) && avg.processes.topByCpu.length) {
			html += '<div class="process-section"><h5>Top by CPU (avg)</h5>';
			avg.processes.topByCpu.slice(0,3).forEach((p, idx) => {
				html += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.name)}</div><div class="process-stats">CPU ${Number(p.avgCpu||0).toFixed(1)}%  · Mem ${Number(p.avgMem||0).toFixed(1)}%</div></div>`;
			});
			html += '</div>';
		}
		if (Array.isArray(avg.processes.topByMem) && avg.processes.topByMem.length) {
			html += '<div class="process-section"><h5>Top by Memory (avg)</h5>';
			avg.processes.topByMem.slice(0,3).forEach((p, idx) => {
				html += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.name)}</div><div class="process-stats">Mem ${Number(p.avgMem||0).toFixed(1)}%  · CPU ${Number(p.avgCpu||0).toFixed(1)}%</div></div>`;
			});
			html += '</div>';
		}
		if (Array.isArray(avg.processes.topByNet) && avg.processes.topByNet.length) {
			html += '<div class="process-section"><h5>Top by Network (avg)</h5>';
			avg.processes.topByNet.slice(0,3).forEach((p, idx) => {
				html += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.name)}</div><div class="process-stats">${Number(p.avgNet||0).toFixed(1)} KB/s  · CPU ${Number(p.avgCpu||0).toFixed(1)}%</div></div>`;
			});
			html += '</div>';
		}
		if (Array.isArray(avg.processes.topByDisk) && avg.processes.topByDisk.length) {
			html += '<div class="process-section"><h5>Top by Disk IO (avg)</h5>';
			avg.processes.topByDisk.slice(0,3).forEach((p, idx) => {
				html += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.name)}</div><div class="process-stats">${Number(p.avgDiskKBps||0).toFixed(1)} KB/s  · CPU ${Number(p.avgCpu||0).toFixed(1)}%</div></div>`;
			});
			html += '</div>';
		}
		html += '</div>';
		procCard.innerHTML = html;
		labOverviewEl.appendChild(procCard);
	}

	// Render top PCs by disk / network
	const existingIO = document.getElementById('labIO');
	if (existingIO) existingIO.remove();
	if (avg && (avg.topPcsByDisk || avg.topPcsByNet)) {
		const ioCard = document.createElement('div');
		ioCard.id = 'labIO';
		ioCard.className = 'card lab-processes';
		ioCard.style.marginTop = '12px';
		let ioHtml = `<div class="card-header"><h4>Top PCs (I/O)</h4></div><div class="process-rows">`;
		if (Array.isArray(avg.topPcsByDisk) && avg.topPcsByDisk.length) {
			ioHtml += '<div class="process-section"><h5>Top PCs by Disk % (avg)</h5>';
			avg.topPcsByDisk.slice(0,3).forEach((p, idx) => {
				ioHtml += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.pcId)}</div><div class="process-stats">Disk ${Number(p.avgDiskUsedPercent||0).toFixed(1)}%</div></div>`;
			});
			ioHtml += '</div>';
		}
		if (Array.isArray(avg.topPcsByNet) && avg.topPcsByNet.length) {
			ioHtml += '<div class="process-section"><h5>Top PCs by Network (KB/s avg)</h5>';
			avg.topPcsByNet.slice(0,3).forEach((p, idx) => {
				ioHtml += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.pcId)}</div><div class="process-stats">${Number(p.avgNetKBps||0).toFixed(1)} KB/s</div></div>`;
			});
			ioHtml += '</div>';
		}
		if (Array.isArray(avg.topPcsByCpu) && avg.topPcsByCpu.length) {
			ioHtml += '<div class="process-section"><h5>Top PCs by CPU (avg)</h5>';
			avg.topPcsByCpu.slice(0,3).forEach((p, idx) => {
				ioHtml += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.pcId)}</div><div class="process-stats">CPU ${Number(p.avgCpuLoadPercent||0).toFixed(1)}% · Mem ${Number(p.avgMemUsedPercent||0).toFixed(1)}%</div></div>`;
			});
			ioHtml += '</div>';
		}
		if (Array.isArray(avg.topPcsByMem) && avg.topPcsByMem.length) {
			ioHtml += '<div class="process-section"><h5>Top PCs by Memory (avg)</h5>';
			avg.topPcsByMem.slice(0,3).forEach((p, idx) => {
				ioHtml += `<div class="process-item-row"><div class="proc-badge">${idx+1}</div><div class="process-name">${escapeHtml(p.pcId)}</div><div class="process-stats">Mem ${Number(p.avgMemUsedPercent||0).toFixed(1)}% · CPU ${Number(p.avgCpuLoadPercent||0).toFixed(1)}%</div></div>`;
			});
			ioHtml += '</div>';
		}
		ioHtml += '</div>';
		ioCard.innerHTML = ioHtml;
		labOverviewEl.appendChild(ioCard);
	}
}


// Update chart data without recreating the chart
function updateChartData(chartId, labels, data) {
    const chart = Chart.getChart(chartId);
    if (chart) {
        chart.data.labels = labels;
        chart.data.datasets[0].data = data;
        chart.update('none'); // Use 'none' mode for smooth updates
    }
}

document.addEventListener('DOMContentLoaded', () => {
	// Initialize theme
	initTheme();
	
	loadLab().then(() => {
		const labId = getQueryParam('labId') || 'lab-1';
		
		// Initial load
		updateLabSummary(labId).catch(console.error);
		updateLastUpdated();
		
		// Auto-refresh every 1 second
		setInterval(() => {
			const currentLabId = getQueryParam('labId') || 'lab-1';
			Promise.all([
				loadLabOverview(currentLabId),
				loadLabsSidebar(currentLabId),
				updateLabSummary(currentLabId)
			]).catch(()=>{});
			updateLastUpdated();
		}, 1000);
	}).catch(console.error);
});


