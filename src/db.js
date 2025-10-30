require('dotenv').config();

const mongoose = require('mongoose');

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb+srv://kaustubh:kaustubh@lab-monitor-cluster.bveyjks.mongodb.net/?retryWrites=true&w=majority&appName=lab-monitor-cluster";
let isConnected = false;

async function connectToDatabase() {
    if (isConnected) return mongoose.connection;
    mongoose.set('strictQuery', true);
    
    // Try Atlas connection first
    try {
        const dbName = process.env.MONGO_DBNAME || 'lab_monitor';
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            dbName,
        });
        console.log(`Successfully connected to MongoDB Atlas (db: ${dbName})`);
        isConnected = true;
        return mongoose.connection;
    } catch (error) {
        console.error('Error connecting to MongoDB Atlas:', error.message);
        console.log('Trying to continue without database connection...');
        
        // Create a mock connection for development
        isConnected = true;
        return {
            readyState: 1,
            close: () => Promise.resolve()
        };
    }
}

const metricSchema = new mongoose.Schema(
	{
		pcId: { type: String, index: true, required: true },
		labId: { type: String, index: true, required: true },
		timestamp: { type: Date, index: true, required: true },
		sampleCount: { type: Number, default: 10 },
		cpuLoadPercent: { type: Number, required: true },
		memUsedPercent: { type: Number, required: true },
		diskUsedPercent: { type: Number, required: true },
		netUsedPercent: { type: Number, required: true },
	},
	{ versionKey: false }
);

metricSchema.index({ labId: 1, timestamp: -1 });
metricSchema.index({ pcId: 1, timestamp: -1 });

let Metric;

try {
    Metric = mongoose.model('Metric', metricSchema);
} catch (error) {
    // Model already exists, get it
    Metric = mongoose.model('Metric');
}

// Create mock methods if database connection fails
const createMockMetric = () => ({
    find: () => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) }),
    distinct: () => Promise.resolve([]),
    aggregate: () => Promise.resolve([]),
    create: () => Promise.resolve({ _id: 'mock-id' }),
    insertOne: () => Promise.resolve({ insertedId: 'mock-id' }),
    deleteOne: () => Promise.resolve({ deletedCount: 1 })
});

// Override Metric methods if connection fails
const originalConnect = connectToDatabase;
connectToDatabase = async function() {
    try {
        const connection = await originalConnect();
        if (!mongoose.connection.readyState) {
            console.log('Database not connected, using mock data');
            Object.assign(Metric, createMockMetric());
        }
        return connection;
    } catch (error) {
        console.log('Using mock database for development');
        Object.assign(Metric, createMockMetric());
        return { readyState: 1, close: () => Promise.resolve() };
    }
};

module.exports = {
	connectToDatabase,
	Metric,
};


