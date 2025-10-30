const express = require('express');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const port = 3333;

async function testEndpoints() {
    const uri = process.env.MONGO_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');
        
        const db = client.db('lab_monitor');
        const metrics = db.collection('metrics');

        // Test endpoint to check latest data
        app.get('/test/latest', async (req, res) => {
            const latest = await metrics.find({})
                .sort({ timestamp: -1 })
                .limit(1)
                .toArray();
            
            res.json({
                latestDoc: latest[0],
                timestamp: new Date().toISOString(),
                found: latest.length > 0
            });
        });

        // Test endpoint to check updates
        app.get('/test/updates', async (req, res) => {
            const last5mins = new Date(Date.now() - 5 * 60 * 1000);
            const recentDocs = await metrics.find({
                timestamp: { $gte: last5mins }
            }).toArray();

            res.json({
                recentCount: recentDocs.length,
                timestamps: recentDocs.map(d => d.timestamp),
                now: new Date().toISOString()
            });
        });

        app.listen(port, () => {
            console.log(`Test server running at http://localhost:${port}`);
            console.log('Try:');
            console.log(`  http://localhost:${port}/test/latest`);
            console.log(`  http://localhost:${port}/test/updates`);
        });

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

testEndpoints().catch(console.error);