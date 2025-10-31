// Global state
let systemData = {
	summary: { cpu: 0, memory: 0, disk: 0, network: 0 },
	health: 'checking',
	lastUpdated: null,
	peakValues: { cpu: 0, memory: 0 },
	activePcs: 0
};

async function fetchJSON(url) {
	try {
		const res = await fetch(url);
		if (!res.ok) {
			console.error(`fetchJSON error: ${url} returned ${res.status}`);
			throw new Error(`Request failed ${res.status}`);
		}
		return await res.json();
	} catch (err) {
		console.error('fetchJSON network error for', url, err);
		throw err;
	}
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
	systemData.lastUpdated = now;
}

// Update system summary
async function updateSystemSummary() {
	try {
		const labs = await fetchJSON('/api/labs');
		if (labs.length === 0) return;
		
		const labId = labs[0]; // Use first lab for summary
		const [series, avg] = await Promise.all([
			fetchJSON(`/api/lab/series?labId=${encodeURIComponent(labId)}&limit=1`),
			fetchJSON(`/api/avg/lab?labId=${encodeURIComponent(labId)}&limit=100`)
		]);
		
		if (avg) {
			systemData.summary = {
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
			systemData.peakValues.cpu = Math.max(systemData.peakValues.cpu, avg.cpuLoadPercent);
			systemData.peakValues.memory = Math.max(systemData.peakValues.memory, avg.memUsedPercent);
			
			// Update status cards
			document.getElementById('cpuPeak').textContent = `${systemData.peakValues.cpu.toFixed(1)}%`;
			document.getElementById('memoryPeak').textContent = `${systemData.peakValues.memory.toFixed(1)}%`;
			
			// Update health status
			updateHealthStatus();
		}
		
		// Update uptime (simple implementation)
		const uptimeElement = document.getElementById('summaryUptime');
		if (uptimeElement) {
			const now = new Date();
			const startTime = systemData.lastUpdated || now;
			const diff = now - startTime;
			const minutes = Math.floor(diff / 60000);
			uptimeElement.textContent = `${minutes}m`;
		}
		
	} catch (error) {
		console.error('Error updating system summary:', error);
	}
}

// Update health status
function updateHealthStatus() {
	const cpu = systemData.summary.cpu;
	const memory = systemData.summary.memory;
	
	let health = 'healthy';
	let healthText = 'System Stable';
	
	if (cpu > 90 || memory > 90) {
		health = 'danger';
		healthText = 'High Load';
	} else if (cpu > 70 || memory > 70) {
		health = 'warning';
		healthText = 'Moderate Load';
	}
	
	systemData.health = health;
	
	// Update health indicators
	const healthDot = document.querySelector('#systemHealthIndicator .health-dot');
	const healthTextElement = document.querySelector('#systemHealthIndicator .health-text');
	const statusDot = document.querySelector('#systemStatusIndicator .status-dot');
	const statusText = document.querySelector('#systemStatusIndicator .status-text');
	
	if (healthDot) {
		healthDot.className = `health-dot ${health}`;
	}
	if (healthTextElement) {
		healthTextElement.textContent = healthText;
	}
	if (statusDot) {
		statusDot.className = `status-dot ${health === 'healthy' ? 'online' : 'offline'}`;
	}
	if (statusText) {
		statusText.textContent = health === 'healthy' ? 'Online' : 'Alert';
	}
}

function toDataset(name, color, extractor) {
	return (data) => ({
		label: name,
		data: data.map(extractor),
		borderColor: color,
		backgroundColor: color + '33',
		pointRadius: 0,
		tension: 0.2,
	});
}

function renderLineChart(ctx, labels, datasets) {
	return new Chart(ctx, {
		type: 'line',
		data: { labels, datasets },
		options: {
			responsive: true,
			scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true } },
			plugins: { legend: { position: 'bottom' } },
		},
	});
}

let miniCharts = {};


async function loadLabsList() {
	const labs = await fetchJSON('/api/labs');
	const ul = document.getElementById('labList');
	if (!ul) return;
	ul.innerHTML = '';
	if (!labs.length) {
		ul.innerHTML = '<li style="color:#888;padding:8px;">No labs found</li>';
		return;
	}
	
	// Update active PCs count
	systemData.activePcs = labs.length;
	const activePcsElement = document.getElementById('activePcs');
	if (activePcsElement) {
		activePcsElement.textContent = labs.length.toString();
	}
	
	labs.forEach(async (l) => {
		const li = document.createElement('li');
		
		// Get lab health status
		let healthStatus = 'healthy';
		try {
			const avg = await fetchJSON(`/api/avg/lab?labId=${encodeURIComponent(l)}&limit=100`);
			if (avg && (avg.cpuLoadPercent > 90 || avg.memUsedPercent > 90)) {
				healthStatus = 'danger';
			} else if (avg && (avg.cpuLoadPercent > 70 || avg.memUsedPercent > 70)) {
				healthStatus = 'warning';
			}
		} catch (error) {
			console.error('Error fetching lab health:', error);
			healthStatus = 'unknown'; // Set to unknown on error
		}

		const healthIcon = healthStatus === 'healthy' ? '🟢' : healthStatus === 'warning' ? '🟡' : healthStatus === 'unknown' ? '⚪' : '🔴';
		
		li.innerHTML = `<a class="lab-link" href="#">
			<div class="lab-icon">${l.slice(0,2).toUpperCase()}</div>
			<div class="lab-text">
				<span class="lab-name">${l} ${healthIcon}</span>
				<span class="lab-sub">View PCs</span>
			</div>
			<div class="lab-cta">Open ›</div>
		</a>`;
		
		li.querySelector('a').addEventListener('click', (e) => {
			e.preventDefault();
			window.location.href = `/lab.html?labId=${encodeURIComponent(l)}`;
		});
		
		ul.appendChild(li);
	});
}

function formatAvg(avg) {
	if (!avg) return 'No data';
	const netValue = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
	return `CPU ${avg.cpuLoadPercent.toFixed(1)}% · Mem ${avg.memUsedPercent.toFixed(1)}% · Disk ${avg.diskUsedPercent.toFixed(1)}% · Net ${netValue}`;
}

function ensureChart(key, ctx, labels, data, color, label) {
	const existing = miniCharts[key];
	if (existing) {
		existing.data.labels = labels;
		existing.data.datasets[0].data = data;
		existing.update();
		return existing;
	}
	const chart = new Chart(ctx, {
		type: 'line',
		data: { labels, datasets: [{ label, data, borderColor: color, backgroundColor: color + '33', pointRadius: 0, tension: 0.2 }] },
		options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
	});
	miniCharts[key] = chart;
	return chart;
}

async function renderLabSection(labId) {
	const title = document.getElementById('labTitle');
	if (title) title.textContent = `Lab: ${labId}`;
	const [series, avg] = await Promise.all([
		fetchJSON(`/api/lab/series?labId=${encodeURIComponent(labId)}&limit=200`),
		fetchJSON(`/api/avg/lab?labId=${encodeURIComponent(labId)}&limit=200`),
	]);
	const avgEl = document.getElementById('labAvg');
	if (avgEl) avgEl.textContent = formatAvg(avg);
	const labels = series.map((d) => new Date(d.timestamp).toLocaleTimeString());
	if (document.getElementById('labCpu')) ensureChart('labCpu', document.getElementById('labCpu').getContext('2d'), labels, series.map(d=>d.cpuLoadPercent), '#ef4444', 'CPU %');
	if (document.getElementById('labMem')) ensureChart('labMem', document.getElementById('labMem').getContext('2d'), labels, series.map(d=>d.memUsedPercent), '#22c55e', 'Mem %');
	if (document.getElementById('labDisk')) ensureChart('labDisk', document.getElementById('labDisk').getContext('2d'), labels, series.map(d=>d.diskUsedPercent), '#3b82f6', 'Disk %');
	if (document.getElementById('labNet')) ensureChart('labNet', document.getElementById('labNet').getContext('2d'), labels, series.map(d=>d.netUsedPercent), '#06b6d4', 'Net %');
}

async function renderPcGrid(labId) {
	const container = document.getElementById('pcGrid');
	if (!container) return;
	container.innerHTML = '';
	const pcs = await fetchJSON(`/api/labs/${encodeURIComponent(labId)}/pcs`);
	const limit = 120;
	
	// Update PC count
	const pcCountElement = document.getElementById('pcCount');
	if (pcCountElement) {
		pcCountElement.textContent = `${pcs.length} PC${pcs.length !== 1 ? 's' : ''}`;
	}
	
	for (const pcId of pcs) {
		const card = document.createElement('div');
		card.className = 'pc-card';
		card.innerHTML = `
			<div class="pc-header">
				<div class="pc-id"><span class="dot"></span><strong>${pcId}</strong></div>
				<div class="pc-avg" id="avg-${pcId}"></div>
			</div>
			<div class="mini-grid">
				<canvas id="${pcId}-cpu"></canvas>
				<canvas id="${pcId}-mem"></canvas>
				<canvas id="${pcId}-disk"></canvas>
				<canvas id="${pcId}-net"></canvas>
			</div>
		`;
		container.appendChild(card);

		(async () => {
			const updatePcData = async () => {
				const [series, avg] = await Promise.all([
					fetchJSON(`/api/series?pcId=${encodeURIComponent(pcId)}&limit=${limit}`),
					fetchJSON(`/api/avg/pc?pcId=${encodeURIComponent(pcId)}&limit=${limit}`),
				]);
				
				if (avg) {
					// Update PC health indicator
					const dot = card.querySelector('.dot');
					if (avg.cpuLoadPercent > 90 || avg.memUsedPercent > 90) {
						dot.className = 'dot danger';
					} else if (avg.cpuLoadPercent > 70 || avg.memUsedPercent > 70) {
						dot.className = 'dot warning';
					} else {
						dot.className = 'dot';
					}
					
						// Update summary values if this is the first PC
						if (pcId === pcs[0]) {
							document.getElementById('summaryCpu').textContent = `${avg.cpuLoadPercent.toFixed(1)}%`;
							document.getElementById('summaryMemory').textContent = `${avg.memUsedPercent.toFixed(1)}%`;
							document.getElementById('summaryDisk').textContent = `${avg.diskUsedPercent.toFixed(1)}%`;
							const netValue = avg.netKBps ? `${avg.netKBps.toFixed(1)} KB/s` : `${avg.netUsedPercent.toFixed(1)}%`;
							document.getElementById('summaryNetwork').textContent = netValue;
						}
				}
				
				const labels = series.map((d) => new Date(d.timestamp).toLocaleTimeString());
				document.getElementById(`avg-${pcId}`).textContent = formatAvg(avg);
				ensureChart(`${pcId}-cpu`, document.getElementById(`${pcId}-cpu`).getContext('2d'), labels, series.map(d=>d.cpuLoadPercent), '#ef4444', 'CPU %');
				ensureChart(`${pcId}-mem`, document.getElementById(`${pcId}-mem`).getContext('2d'), labels, series.map(d=>d.memUsedPercent), '#22c55e', 'Mem %');
				ensureChart(`${pcId}-disk`, document.getElementById(`${pcId}-disk`).getContext('2d'), labels, series.map(d=>d.diskUsedPercent), '#3b82f6', 'Disk %');
				ensureChart(`${pcId}-net`, document.getElementById(`${pcId}-net`).getContext('2d'), labels, series.map(d=>d.netUsedPercent), '#06b6d4', 'Net %');
			};
			
			// Initial load
			await updatePcData();
			
			// Auto-refresh every 3 seconds (match agent upload interval)
			setInterval(updatePcData, 3000);
		})().catch(console.error);
	}
}

// Small live preview for PC '1' on the index page (non-intrusive)
async function initQuickPcPreview(pcId = '1') {
	try {
		const summaryBar = document.querySelector('.summary-bar');
		if (!summaryBar) return;
		// Avoid duplicate
		if (document.getElementById('quickPreviewCard')) return;
		const wrapper = document.createElement('div');
		wrapper.id = 'quickPreviewCard';
		wrapper.className = 'card quick-preview-card';
		wrapper.style.margin = '16px 24px';
		wrapper.innerHTML = `
			<div class="card-header"><h3>Live Preview — PC ${pcId}</h3></div>
			<div style="display:flex;align-items:center;gap:12px">
				<canvas id="quickPreviewCanvas" width="300" height="80"></canvas>
				<div style="min-width:140px">
					<div style="font-weight:600">PC ${pcId}</div>
					<div id="quickPreviewStats">Loading...</div>
				</div>
			</div>
		`;
		// Insert after summary bar
		summaryBar.parentNode.insertBefore(wrapper, summaryBar.nextSibling);

		const ctx = document.getElementById('quickPreviewCanvas').getContext('2d');
		async function updatePreview() {
			try {
				const series = await fetchJSON(`/api/series?pcId=${encodeURIComponent(pcId)}&limit=60`);
				if (!series || !series.length) return;
				const labels = series.map(d => new Date(d.timestamp).toLocaleTimeString());
				const data = series.map(d => d.cpuLoadPercent || 0);
				ensureChart(`quick-${pcId}`, ctx, labels, data, '#ef4444', 'CPU %');
				const latest = series[series.length - 1];
				document.getElementById('quickPreviewStats').textContent = `CPU ${latest.cpuLoadPercent.toFixed(1)}% · Mem ${((latest.memUsedPercent||0).toFixed(1))}%`;
			} catch (err) {
				console.error('Error updating quick preview:', err);
			}
		}
		// initial and interval (match agent upload interval)
		await updatePreview();
		setInterval(updatePreview, 3000);
	} catch (err) {
		console.error('initQuickPcPreview failed', err);
	}
}

function getQueryParam(name) {
	const params = new URLSearchParams(window.location.search);
	return params.get(name);
}

async function refreshAll() {
	const labId = getQueryParam('labId') || 'lab-1';
	await Promise.all([
		renderLabSection(labId),
		renderPcGrid(labId),
	]);
}


document.addEventListener('DOMContentLoaded', () => {
	// Initialize theme
	initTheme();
	
	// Initial load
	loadLabsList().catch(console.error);
	updateSystemSummary().catch(console.error);
	updateLastUpdated();
	
	// Start quick preview for PC '1' so live data is visible on index
	initQuickPcPreview('1');
	
	// Auto-refresh every 3 seconds (match agent upload interval)
	setInterval(async () => {
		try {
			// Save current scroll position
			const scrollPos = window.scrollY;
			await Promise.all([
				loadLabsList(),
				updateSystemSummary()
			]);
			updateLastUpdated();
			// Restore scroll position
			window.scrollTo(0, scrollPos);
		} catch (error) {
			console.error('Auto-refresh error:', error);
		}
	}, 3000);
});


