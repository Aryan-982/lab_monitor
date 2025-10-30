require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
console.log('Testing connection to:', uri ? 'MongoDB URI found in .env' : 'No MongoDB URI found!');

async function testConnection() {
    const client = new MongoClient(uri, {
        serverApi: {
            version: '1',
            strict: true,
            deprecationErrors: true,
        }
    });

    try {
        await client.connect();
        console.log('Successfully connected to MongoDB!');
        
        const db = client.db('lab_monitor');
        const metrics = await db.collection('metrics').find({}).limit(1).toArray();
        console.log('Latest metric:', metrics[0] ? 
            `Found - Lab: ${metrics[0].labId}, PC: ${metrics[0].pcId}, Time: ${metrics[0].timestamp}` : 
            'No metrics found in collection');
    } catch (err) {
        console.error('MongoDB connection failed:', err.message);
    } finally {
        await client.close();
    }
}

testConnection().catch(console.error);