require('dotenv').config();
const fs = require('fs');
const path = require('path');
const si = require('systeminformation');
const { connectToDatabase, Metric } = require('./db');

const SAMPLE_SECONDS = Number(process.env.SAMPLE_SECONDS || 1);
const BATCH_SECONDS = Number(process.env.BATCH_SECONDS || 10);
const LAB_ID = process.env.LAB_ID || 'lab-1';
const PC_ID = process.env.PC_ID || require('os').hostname();

const BUFFER_FILE = path.join(process.cwd(), 'metrics_buffer.txt');

/**
 * Safely append one JSON line to buffer file
 */
function appendSampleToBuffer(sample) {
	const line = JSON.stringify(sample) + '\n';
	fs.appendFileSync(BUFFER_FILE, line);
}

/**
 * Read all lines from buffer and parse JSON
 */
function readBufferSamples() {
	if (!fs.existsSync(BUFFER_FILE)) return [];
	const raw = fs.readFileSync(BUFFER_FILE, 'utf8');
	return raw
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			try { return JSON.parse(line); } catch { return null; }
		})
		.filter(Boolean);
}

function clearBuffer() {
	fs.writeFileSync(BUFFER_FILE, '');
}

function average(numbers) {
	if (!numbers.length) return 0;
	return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

async function collectOnce() {
    async function getCpuLoadPercent() {
        try {
            let l = await si.currentLoad();
            let value = typeof l.currentload === 'number' ? l.currentload : 0;
            if (!value && Array.isArray(l.cpus) && l.cpus.length) {
                value = l.cpus.reduce((a,c)=>a+(typeof c.load==='number'?c.load:0),0) / l.cpus.length;
            }
            if (!value) {
                await new Promise(r=>setTimeout(r,250));
                l = await si.currentLoad();
                value = typeof l.currentload === 'number' ? l.currentload : 0;
                if (!value && Array.isArray(l.cpus) && l.cpus.length) {
                    value = l.cpus.reduce((a,c)=>a+(typeof c.load==='number'?c.load:0),0) / l.cpus.length;
                }
            }
            return value || 0;
        } catch { return 0; }
    }

    const [cpuLoadPercent, mem, disksIO, netStats, fsSizes] = await Promise.all([
        getCpuLoadPercent(),
    si.mem(),
    si.disksIO().catch(() => ({})),
    si.networkStats(),
    si.fsSize().catch(() => ([])),
]);

const memUsedPercent = mem.total ? ((mem.active || mem.used) / mem.total) * 100 : 0;

// Disk throughput (KB/s)
const diskReadKBps = (disksIO.rIO_sec ? disksIO.rIO_sec * 512 : (disksIO.readBytes || 0)) / 1024;
const diskWriteKBps = (disksIO.wIO_sec ? disksIO.wIO_sec * 512 : (disksIO.writeBytes || 0)) / 1024;

// Network throughput (KB/s)
let netRxKBps = 0;
let netTxKBps = 0;
if (Array.isArray(netStats)) {
    netRxKBps = average(netStats.map((n) => (n.rx_sec || 0))) / 1024;
    netTxKBps = average(netStats.map((n) => (n.tx_sec || 0))) / 1024;
} else if (netStats && typeof netStats === 'object') {
    netRxKBps = (netStats.rx_sec || 0) / 1024;
    netTxKBps = (netStats.tx_sec || 0) / 1024;
}

// Optional percent-based metrics
let diskUsedPercent = 0;
if (Array.isArray(fsSizes) && fsSizes.length) {
    const uses = fsSizes.map(d => typeof d.use === 'number' ? d.use : (d.used && d.size ? (d.used / d.size) * 100 : 0));
    diskUsedPercent = average(uses);
}

// Estimate network capacity from interface speeds when available
let netUsedPercent = 0;
try {
    const ifaces = await si.networkInterfaces();
    const ifaceSpeedsKBps = ifaces.map(i => i.speed ? i.speed * 125 : 0).filter(Boolean);
    const maxKBps = ifaceSpeedsKBps.length ? Math.max(...ifaceSpeedsKBps) : 125000; // default 1Gbps
    const totalKBps = netRxKBps + netTxKBps;
    netUsedPercent = maxKBps ? (totalKBps / maxKBps) * 100 : 0;
} catch {
    netUsedPercent = 0;
}

    const sample = {
		pcId: PC_ID,
		labId: LAB_ID,
		timestamp: new Date().toISOString(),
		cpuLoadPercent,
		memUsedPercent,
    diskReadKBps,
    diskWriteKBps,
    netRxKBps,
    netTxKBps,
    diskUsedPercent,
    netUsedPercent,
	};

	appendSampleToBuffer(sample);
}

async function flushAveragesToMongo() {
	const samples = readBufferSamples();
	if (samples.length === 0) return;

	const cpuLoadPercent = average(samples.map((s) => s.cpuLoadPercent));
	const memUsedPercent = average(samples.map((s) => s.memUsedPercent));
	const diskReadKBps = average(samples.map((s) => s.diskReadKBps));
	const diskWriteKBps = average(samples.map((s) => s.diskWriteKBps));
	const netRxKBps = average(samples.map((s) => s.netRxKBps));
	const netTxKBps = average(samples.map((s) => s.netTxKBps));

	await connectToDatabase();
	await Metric.create({
		pcId: PC_ID,
		labId: LAB_ID,
		timestamp: new Date(),
		sampleCount: samples.length,
		cpuLoadPercent,
		memUsedPercent,
		diskReadKBps,
		diskWriteKBps,
		netRxKBps,
		netTxKBps,
	});

	clearBuffer();
}

function startAgent() {
	// Ensure buffer file exists
	if (!fs.existsSync(BUFFER_FILE)) fs.writeFileSync(BUFFER_FILE, '');

	// Sample every SAMPLE_SECONDS
	setInterval(() => {
		collectOnce().catch(() => {});
	}, SAMPLE_SECONDS * 1000);

	// Flush every BATCH_SECONDS
	setInterval(() => {
		flushAveragesToMongo().catch(() => {});
	}, BATCH_SECONDS * 1000);

	// Also flush on exit
	process.on('SIGINT', async () => {
		try {
			await flushAveragesToMongo();
		} finally {
			process.exit(0);
		}
	});
}

module.exports = { startAgent };


