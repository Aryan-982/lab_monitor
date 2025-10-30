const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'metrics_data.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Mock Metric class that uses file storage
class FileMetric {
    static find(query = {}, options = {}) {
        const data = readData();
        let filtered = data;
        
        // Apply filters
        if (query.pcId) {
            filtered = filtered.filter(item => item.pcId === query.pcId);
        }
        if (query.labId) {
            filtered = filtered.filter(item => item.labId === query.labId);
        }
        
        return {
            sort: (sortObj) => {
                if (sortObj.timestamp === -1) {
                    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                } else {
                    filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                }
                return {
                    limit: (limit) => ({
                        lean: () => Promise.resolve(filtered.slice(0, limit))
                    })
                };
            },
            limit: (limit) => ({
                lean: () => Promise.resolve(filtered.slice(0, limit))
            }),
            lean: () => Promise.resolve(filtered)
        };
    }
    
    static async distinct(field, query = {}) {
        const data = readData();
        let filtered = data;
        
        if (query.labId) {
            filtered = filtered.filter(item => item.labId === query.labId);
        }
        
        const values = [...new Set(filtered.map(item => item[field]))];
        return values.sort();
    }
    
    static async aggregate(pipeline) {
        const data = readData();
        
        // Simple implementation for lab series aggregation
        // Filter by labId if present
        let filtered = data;
        if (pipeline[0] && pipeline[0].$match && pipeline[0].$match.labId) {
            filtered = data.filter(item => item.labId === pipeline[0].$match.labId);
        }
        
        // Sort by timestamp descending and limit
        if (pipeline[1] && pipeline[1].$sort && pipeline[1].$sort.timestamp === -1) {
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }
        
        if (pipeline[2] && pipeline[2].$limit) {
            filtered = filtered.slice(0, pipeline[2].$limit);
        }
        
        // For lab aggregation, we need to group by time buckets and average metrics
        // This is a simplified version - just return recent data with averages
        const result = [];
        const now = Date.now();
        
        // Group data into 10-second buckets and calculate averages
        const buckets = {};
        filtered.forEach(item => {
            const timestamp = new Date(item.timestamp).getTime();
            const bucket = Math.floor(timestamp / 10000) * 10000; // 10-second buckets
            
            if (!buckets[bucket]) {
                buckets[bucket] = {
                    count: 0,
                    cpuLoadPercent: 0,
                    memUsedPercent: 0,
                    diskUsedPercent: 0,
                    netUsedPercent: 0,
                    netKBps: 0,
                    uptimeSeconds: 0,
                    timestamp: new Date(bucket)
                };
            }
            
            buckets[bucket].count++;
            buckets[bucket].cpuLoadPercent += item.cpuLoadPercent || 0;
            buckets[bucket].memUsedPercent += item.memUsedPercent || 0;
            buckets[bucket].diskUsedPercent += item.diskUsedPercent || 0;
            buckets[bucket].netUsedPercent += item.netUsedPercent || 0;
            buckets[bucket].netKBps += item.netKBps || 0;
            buckets[bucket].uptimeSeconds = Math.max(buckets[bucket].uptimeSeconds, item.uptimeSeconds || 0);
        });
        
        // Calculate averages
        Object.keys(buckets).forEach(bucket => {
            const b = buckets[bucket];
            b.cpuLoadPercent = b.cpuLoadPercent / b.count;
            b.memUsedPercent = b.memUsedPercent / b.count;
            b.diskUsedPercent = b.diskUsedPercent / b.count;
            b.netUsedPercent = b.netUsedPercent / b.count;
            b.netKBps = b.netKBps / b.count;
            b._id = bucket;
            result.push(b);
        });
        
        // Sort by timestamp ascending for display
        result.sort((a, b) => a.timestamp - b.timestamp);
        
        return result.slice(-50); // Return last 50 buckets
    }
    
    static async create(doc) {
        const data = readData();
        const newDoc = {
            ...doc,
            _id: Date.now().toString(),
            timestamp: new Date()
        };
        data.push(newDoc);
        writeData(data);
        return newDoc;
    }

    static async insertOne(doc) {
        const data = readData();
        const newDoc = {
            ...doc,
            _id: Date.now().toString(),
            timestamp: new Date()
        };
        data.push(newDoc);
        writeData(data);
        return { insertedId: newDoc._id };
    }
    
    static async deleteOne(query) {
        const data = readData();
        const filtered = data.filter(item => {
            for (let key in query) {
                if (item[key] !== query[key]) return true;
            }
            return false;
        });
        writeData(filtered);
        return { deletedCount: data.length - filtered.length };
    }
}

async function connectToDatabase() {
    console.log('Using file-based database for development');
    return {
        readyState: 1,
        close: () => Promise.resolve()
    };
}

module.exports = {
    connectToDatabase,
    Metric: FileMetric
};
