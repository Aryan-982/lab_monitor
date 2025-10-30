require('dotenv').config();
const si = require('systeminformation');
const readline = require('readline');
const { MongoClient, ServerApiVersion } = require('mongodb');

// Build MongoDB Atlas URI from env vars.
// Supported forms (checked in order):
// 1) MONGO_URI (full connection string)
// 2) MONGO_USER, MONGO_PASS, MONGO_HOST (builds mongodb+srv://USER:PASS@HOST/?appName=...)
const { MONGO_URI, MONGO_USER, MONGO_PASS, MONGO_HOST, MONGO_APPNAME } = process.env;
let uri = MONGO_URI;
if (!uri && MONGO_USER && MONGO_PASS && MONGO_HOST) {
        const appName = MONGO_APPNAME || 'Cluster0';
        uri = `mongodb+srv://${encodeURIComponent(MONGO_USER)}:${encodeURIComponent(MONGO_PASS)}@${MONGO_HOST}/?appName=${appName}`;
}
if (!uri) {
        console.error('[agent] MongoDB connection info not found in env. Set MONGO_URI or MONGO_USER/MONGO_PASS/MONGO_HOST in data_getter/.env');
        process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db = null;
let metricsCollection = null;

async function connectToDatabase() {
    if (db && metricsCollection) return;
    try {
        await client.connect();
        db = client.db('lab_monitor');
        metricsCollection = db.collection('metrics');
        console.log('[agent] Connected to MongoDB Atlas');
    } catch (err) {
        console.error('[agent] MongoDB connection error:', err);
        process.exit(1);
    }
}


const SAMPLE_SECONDS = 3;  // collect every 3 seconds (per user request)

let LAB_ID = '';
let PC_ID = '';
let startTime = Date.now(); // Track uptime

async function collectOnce() {
    try {
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

        const [cpuLoadPercent, mem, fsSizes, netStats, procInfo] = await Promise.all([
            getCpuLoadPercent(),
            si.mem().catch(() => ({})),
            si.fsSize().catch(() => ([])),
            si.networkStats().catch(() => ([])),
            si.processes().catch(() => ({})),
        ]);

        // Memory percent
        const memUsedPercent = mem && mem.total ? ((mem.active || mem.used) / mem.total) * 100 : 0;
        // Disk percent
        let diskUsedPercent = 0;
        if (Array.isArray(fsSizes) && fsSizes.length) {
            const diskValues = fsSizes.map(d => typeof d.use === 'number' ? d.use : (d.used && d.size ? (d.used / d.size) * 100 : 0));
            diskUsedPercent = diskValues.reduce((a, b) => a + b, 0) / diskValues.length;
        }
        // Network throughput in KB/s (actual values, not percentage)
        let netKBps = 0;
        let netUsedPercent = 0;
        if (Array.isArray(netStats) && netStats.length) {
            const netValues = netStats.map(n => ((n.rx_sec || 0) + (n.tx_sec || 0)) / 1024);
            netKBps = netValues.reduce((a, b) => a + b, 0) / netValues.length;
            // Convert to percentage for compatibility, but store actual KB/s value
            let maxKBps = 125000; // 1 Gbps = 125000 KB/s
            try {
                const ifaces = await si.networkInterfaces();
                const ifaceSpeeds = ifaces.map(i => i.speed ? i.speed * 125 : 0).filter(Boolean);
                if (ifaceSpeeds.length > 0) maxKBps = Math.max(...ifaceSpeeds);
            } catch {}
            netUsedPercent = maxKBps ? (netKBps / maxKBps) * 100 : 0;
        }
        // Calculate uptime in seconds
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        
        // Build top processes list (by CPU)
        let topProcesses = [];
        try {
            const procList = Array.isArray(procInfo.list) ? procInfo.list : (Array.isArray(procInfo.all) ? procInfo.all : (procInfo.processes || []));
            if (Array.isArray(procList) && procList.length) {
                topProcesses = procList
                    .map(p => ({ pid: p.pid, name: p.name || p.command || p.cmd, cpu: Number(p.cpu) || 0, mem: Number(p.mem) || Number(p.memUsage) || 0 }))
                    .sort((a, b) => b.cpu - a.cpu)
                    .slice(0, 5);
            }
        } catch (e) { topProcesses = []; }
        
        // Save directly to MongoDB Atlas
        await saveToDatabase({
            pcId: PC_ID,
            labId: LAB_ID,
            timestamp: new Date().toISOString(),
            cpuLoadPercent,
            memUsedPercent,
            diskUsedPercent,
            netUsedPercent,
            netKBps, // Store actual KB/s value
            uptimeSeconds,
            processes: topProcesses,
        });
    } catch (err) {
        console.error('[agent] Error collecting sample:', err);
    }
}

async function saveToDatabase(sample) {
    try {
        await connectToDatabase();
        const newMetric = {
            pcId: sample.pcId,
            labId: sample.labId,
            timestamp: new Date(sample.timestamp),
            sampleCount: 1,
            cpuLoadPercent: sample.cpuLoadPercent,
            memUsedPercent: sample.memUsedPercent,
            diskUsedPercent: sample.diskUsedPercent,
            netUsedPercent: sample.netUsedPercent,
            netKBps: sample.netKBps || 0,
            // include top processes so UI can display them
            processes: Array.isArray(sample.processes) ? sample.processes : [],
            uptimeSeconds: sample.uptimeSeconds || 0,
        };
        await metricsCollection.insertOne(newMetric);
        console.log(`[agent] Uploaded sample: CPU ${sample.cpuLoadPercent.toFixed(1)}%, Mem ${sample.memUsedPercent.toFixed(1)}%`);
    } catch (err) {
        console.error('[agent] Error uploading to MongoDB Atlas:', err);
    }
}

function askLabAndPc(callback) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Enter Lab ID: ', (lab) => {
        LAB_ID = lab.trim();
        rl.question('Enter PC ID: ', (pc) => {
            PC_ID = pc.trim();
            rl.close();
            callback();
        });
    });
}


function startAgent() {
    console.log(`[agent] Starting agent for Lab: ${LAB_ID}, PC: ${PC_ID}`);
    console.log(`[agent] Collecting metrics every ${SAMPLE_SECONDS} second(s)`);
    setInterval(() => { collectOnce().catch(()=>{}); }, SAMPLE_SECONDS * 1000);
    process.on('SIGINT', async () => {
        console.log('[agent] Shutting down gracefully...');
        try {
            if (client) await client.close();
        } catch (e) {}
        process.exit(0);
    });
}

askLabAndPc(startAgent);
