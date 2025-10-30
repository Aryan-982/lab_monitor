require('dotenv').config();
console.log('MONGO_URI from env:', process.env.MONGO_URI ? 'Found (starts with: ' + process.env.MONGO_URI.substring(0, 20) + '...)' : 'Not found');