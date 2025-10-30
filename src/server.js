require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectToDatabase, Metric } = require('./db');

const PORT = Number(process.env.PORT || 8080);

async function main() {
	await connectToDatabase();

	const app = express();
	
	// Configure security headers
	app.use((req, res, next) => {
		res.setHeader('Content-Security-Policy', "default-src 'self' https://cdn.jsdelivr.net; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src-elem 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' https://cdnjs.cloudflare.com; connect-src 'self' https://cdn.jsdelivr.net");
		next();
	});

	app.use(cors());
	app.use(express.json());

	// Serve static dashboard with proper caching
	app.use('/', express.static(path.join(__dirname, '..', 'public'), {
		etag: true,
		lastModified: true,
		setHeaders: (res, filePath) => {
			if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
				res.setHeader('Cache-Control', 'no-cache');
			} else {
				res.setHeader('Cache-Control', 'max-age=31536000');
			}
		}
	}));

	// Health
	app.get('/api/health', (_req, res) => res.json({ ok: true }));

	// Labs list
	app.get('/api/labs', async (_req, res) => {
		const labs = await Metric.distinct('labId');
		labs.sort();
		res.json(labs);
	});

	// PCs in lab
	app.get('/api/labs/:labId/pcs', async (req, res) => {
		const { labId } = req.params;
		const pcs = await Metric.distinct('pcId', { labId });
		pcs.sort();
		res.json(pcs);
	});

	// Latest N metrics for a PC
	app.get('/api/series', async (req, res) => {
    const pcId = req.query.pcId;
    const labId = req.query.labId;
    const limit = Math.min(Number(req.query.limit || 100), 1000);
    if (!pcId) return res.status(400).json({ error: 'pcId required' });
    if (!labId) return res.status(400).json({ error: 'labId required' });
    const docs = await Metric.find({ pcId, labId }).sort({ timestamp: -1 }).limit(limit).lean();
		res.json(docs.reverse());
	});

	// Average snapshot for a PC (over last N docs)
	app.get('/api/avg/pc', async (req, res) => {
    const pcId = req.query.pcId;
    const labId = req.query.labId;
    const limit = Math.min(Number(req.query.limit || 50), 1000);
    if (!pcId) return res.status(400).json({ error: 'pcId required' });
    if (!labId) return res.status(400).json({ error: 'labId required' });
    const docs = await Metric.find({ pcId, labId }).sort({ timestamp: -1 }).limit(limit).lean();
		if (!docs.length) return res.json(null);
		const avg = (arr) => arr.reduce((a,b)=>a+b,0) / arr.length;
		res.json({
			pcId,
			count: docs.length,
			timestamp: docs[0].timestamp,
			cpuLoadPercent: avg(docs.map(d=>d.cpuLoadPercent)),
			memUsedPercent: avg(docs.map(d=>d.memUsedPercent)),
			diskUsedPercent: avg(docs.map(d=>d.diskUsedPercent)),
			netUsedPercent: avg(docs.map(d=>d.netUsedPercent)),
			netKBps: avg(docs.map(d=>d.netKBps || 0)),
			uptimeSeconds: docs[0].uptimeSeconds || 0,
		});
	});

	// Aggregated series for a lab (average across PCs per 10s window)
	app.get('/api/lab/series', async (req, res) => {
		const labId = req.query.labId;
		const limit = Math.min(Number(req.query.limit || 100), 1000);
		if (!labId) return res.status(400).json({ error: 'labId required' });
		const pipeline = [
			{ $match: { labId } },
			{ $sort: { timestamp: -1 } },
			{ $limit: limit },
			{ $addFields: { bucket: { $toDate: { $subtract: [ { $toLong: '$timestamp' }, { $mod: [ { $toLong: '$timestamp' }, 10000 ] } ] } } } },
			{ $group: {
				_id: '$bucket',
				count: { $sum: 1 },
				cpuLoadPercent: { $avg: '$cpuLoadPercent' },
				memUsedPercent: { $avg: '$memUsedPercent' },
				diskUsedPercent: { $avg: '$diskUsedPercent' },
				netUsedPercent: { $avg: '$netUsedPercent' },
				timestamp: { $first: '$bucket' },
			}},
			{ $sort: { timestamp: 1 } },
		];
		const docs = await Metric.aggregate(pipeline);
		res.json(docs);
	});

	// Average snapshot for a lab (over last N docs)
	app.get('/api/avg/lab', async (req, res) => {
		const labId = req.query.labId;
		const limit = Math.min(Number(req.query.limit || 100), 5000);
		if (!labId) return res.status(400).json({ error: 'labId required' });
		const docs = await Metric.find({ labId }).sort({ timestamp: -1 }).limit(limit).lean();
		if (!docs.length) return res.json(null);
		const avg = (arr) => arr.reduce((a,b)=>a+b,0) / arr.length;
		// Aggregate processes across recent docs for this lab (include net/disk if available)
		const procMap = new Map();
		docs.forEach(d => {
			if (!Array.isArray(d.processes)) return;
			d.processes.forEach(p => {
				const name = p.name || p.command || String(p.pid || 'unknown');
				const cpu = Number(p.cpu) || 0;
				const mem = Number(p.mem) || 0;
				// safe extraction of per-process network (KB/s) - try common fields
				let netKB = 0;
				if (typeof p.netKBps === 'number') netKB = p.netKBps;
				else if (typeof p.netKB === 'number') netKB = p.netKB;
				else if (typeof p.rx === 'number' || typeof p.tx === 'number') netKB = ((Number(p.rx)||0) + (Number(p.tx)||0)) / 1024;
				else if (typeof p.rxBytes === 'number' || typeof p.txBytes === 'number') netKB = ((Number(p.rxBytes)||0) + (Number(p.txBytes)||0)) / 1024;

				// safe extraction of per-process disk IO (KB/s) - try common fields
				let diskKB = 0;
				if (typeof p.diskKBps === 'number') diskKB = p.diskKBps;
				else if (typeof p.io === 'number') diskKB = p.io; // maybe already KB/s
				else if (typeof p.readBytes === 'number' || typeof p.writeBytes === 'number') diskKB = ((Number(p.readBytes)||0) + (Number(p.writeBytes)||0)) / 1024;
				else if (typeof p.rIO_sec === 'number' || typeof p.wIO_sec === 'number') diskKB = ((Number(p.rIO_sec)||0) + (Number(p.wIO_sec)||0)) * 512 / 1024;

				if (!procMap.has(name)) procMap.set(name, { name, cpuSum: 0, memSum: 0, netSum: 0, diskSum: 0, count: 0 });
				const entry = procMap.get(name);
				entry.cpuSum += cpu;
				entry.memSum += mem;
				entry.netSum += netKB;
				entry.diskSum += diskKB;
				entry.count += 1;
			});
		});
		const procAgg = Array.from(procMap.values()).map(e => ({
			name: e.name,
			avgCpu: e.count ? (e.cpuSum / e.count) : 0,
			avgMem: e.count ? (e.memSum / e.count) : 0,
			avgNet: e.count ? (e.netSum / e.count) : 0,
			avgDiskKBps: e.count ? (e.diskSum / e.count) : 0,
			samples: e.count
		}));
		procAgg.sort((a,b) => b.avgCpu - a.avgCpu);
		const topByCpu = procAgg.slice(0, 3);
		procAgg.sort((a,b) => b.avgMem - a.avgMem);
		const topByMem = procAgg.slice(0, 3);
		// If process-level network/disk metrics were collected, include topByNet and topByDisk
		let topByNet = [];
		let topByDisk = [];
		if (procAgg.some(p => typeof p.avgNet === 'number' && p.avgNet > 0)) {
			const byNet = procAgg.slice().sort((a,b) => b.avgNet - a.avgNet);
			topByNet = byNet.slice(0, 3);
		}
		if (procAgg.some(p => typeof p.avgDiskKBps === 'number' && p.avgDiskKBps > 0)) {
			const byDisk = procAgg.slice().sort((a,b) => b.avgDiskKBps - a.avgDiskKBps);
			topByDisk = byDisk.slice(0, 3);
		}

		// Aggregate per-PC cpu/disk/network/memory averages
		const pcMap = new Map();
		docs.forEach(d => {
			const pc = d.pcId || 'unknown';
			if (!pcMap.has(pc)) pcMap.set(pc, { pcId: pc, cpuSum: 0, memSum: 0, diskSum: 0, netSum: 0, count: 0 });
			const entry = pcMap.get(pc);
			entry.cpuSum += (typeof d.cpuLoadPercent === 'number' ? d.cpuLoadPercent : 0);
			entry.memSum += (typeof d.memUsedPercent === 'number' ? d.memUsedPercent : 0);
			entry.diskSum += (typeof d.diskUsedPercent === 'number' ? d.diskUsedPercent : 0);
			entry.netSum += (typeof d.netKBps === 'number' ? d.netKBps : (typeof d.netUsedPercent === 'number' ? d.netUsedPercent : 0));
			entry.count += 1;
		});
		const pcAgg = Array.from(pcMap.values()).map(e => ({
			pcId: e.pcId,
			avgCpuLoadPercent: e.count ? (e.cpuSum / e.count) : 0,
			avgMemUsedPercent: e.count ? (e.memSum / e.count) : 0,
			avgDiskUsedPercent: e.count ? (e.diskSum / e.count) : 0,
			avgNetKBps: e.count ? (e.netSum / e.count) : 0,
			samples: e.count
		}));
		pcAgg.sort((a,b) => b.avgDiskUsedPercent - a.avgDiskUsedPercent);
		const topPcsByDisk = pcAgg.slice(0, 3);
		pcAgg.sort((a,b) => b.avgNetKBps - a.avgNetKBps);
		const topPcsByNet = pcAgg.slice(0, 3);
		pcAgg.sort((a,b) => b.avgCpuLoadPercent - a.avgCpuLoadPercent);
		const topPcsByCpu = pcAgg.slice(0, 3);
		pcAgg.sort((a,b) => b.avgMemUsedPercent - a.avgMemUsedPercent);
		const topPcsByMem = pcAgg.slice(0, 3);

		res.json({
			labId,
			count: docs.length,
			timestamp: docs[0].timestamp,
			cpuLoadPercent: avg(docs.map(d=>d.cpuLoadPercent)),
			memUsedPercent: avg(docs.map(d=>d.memUsedPercent)),
			diskUsedPercent: avg(docs.map(d=>d.diskUsedPercent)),
			netUsedPercent: avg(docs.map(d=>d.netUsedPercent)),
			netKBps: avg(docs.map(d=>d.netKBps || 0)),
			uptimeSeconds: docs[0].uptimeSeconds || 0,
			processes: {
				topByCpu,
				topByMem,
				topByNet
			}
			,
			topPcsByDisk,
			topPcsByNet,
			topPcsByCpu,
			topPcsByMem
		});
	});

	app.listen(PORT, () => {
		console.log(`Server listening on http://localhost:${PORT}`);
	});
}

main().catch((err) => {
	console.error('Fatal error starting server:', err);
	process.exit(1);
});


