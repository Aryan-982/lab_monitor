require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

async function testLabPcData() {
    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');
        
        const db = client.db('lab_monitor');
        const metrics = db.collection('metrics');

        // Test queries for different lab/pc combinations
        async function checkData(labId, pcId) {
            const data = await metrics
                .find({ labId, pcId })
                .sort({ timestamp: -1 })
                .limit(1)
                .toArray();
            
            console.log(`\nChecking Lab: ${labId}, PC: ${pcId}`);
            if (data.length > 0) {
                console.log('Latest data:', {
                    timestamp: data[0].timestamp,
                    cpu: data[0].cpuLoadPercent.toFixed(1) + '%',
                    memory: data[0].memUsedPercent.toFixed(1) + '%'
                });
            } else {
                console.log('No data found');
            }
        }

        // Check a few combinations
        await checkData('1', '1');  // Lab 1, PC 1
        await checkData('2', '1');  // Lab 2, PC 1
        
        // Show total docs per lab
        const labStats = await metrics.aggregate([
            {
                $group: {
                    _id: { lab: '$labId', pc: '$pcId' },
                    count: { $sum: 1 },
                    lastUpdate: { $max: '$timestamp' }
                }
            },
            { $sort: { '_id.lab': 1, '_id.pc': 1 } }
        ]).toArray();

        console.log('\nTotal documents per Lab/PC:');
        labStats.forEach(stat => {
            console.log(`Lab ${stat._id.lab}, PC ${stat._id.pc}: ${stat.count} records, Last update: ${stat.lastUpdate}`);
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.close();
    }
}

testLabPcData().catch(console.error);