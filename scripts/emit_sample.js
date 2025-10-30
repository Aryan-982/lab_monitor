const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'metrics_data.json');

function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function writeData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function rand(min, max) { return Math.random() * (max - min) + min; }

const now = new Date();
const sample = {
  _id: Date.now().toString() + Math.random().toString(36).slice(2,8),
  pcId: '1',
  labId: '1',
  timestamp: now.toISOString(),
  sampleCount: 1,
  cpuLoadPercent: Number(rand(10, 95).toFixed(2)),
  memUsedPercent: Number(rand(20, 90).toFixed(2)),
  diskUsedPercent: Number(rand(10, 80).toFixed(2)),
  netUsedPercent: Number(rand(0, 1).toFixed(6)),
  netKBps: Number(rand(0, 50).toFixed(2)),
  uptimeSeconds: Math.floor(rand(1000, 100000)),
  processes: [
    { pid: 1234, name: 'chrome', cpu: Number(rand(1, 40).toFixed(1)), mem: Number(rand(0.5, 20).toFixed(1)) },
    { pid: 2345, name: 'code', cpu: Number(rand(1, 25).toFixed(1)), mem: Number(rand(0.5, 15).toFixed(1)) },
    { pid: 3456, name: 'node', cpu: Number(rand(0.5, 20).toFixed(1)), mem: Number(rand(0.5, 10).toFixed(1)) },
    { pid: 4567, name: 'python', cpu: Number(rand(0.2, 10).toFixed(1)), mem: Number(rand(0.2, 8).toFixed(1)) },
    { pid: 5678, name: 'systemd', cpu: Number(rand(0, 2).toFixed(1)), mem: Number(rand(0.1, 1).toFixed(1)) }
  ]
};

const data = readData();
data.push(sample);
writeData(data);
console.log('Sample appended:', sample._id);
