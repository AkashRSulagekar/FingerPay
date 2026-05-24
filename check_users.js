const mongoose = require('mongoose');
const MONGO_URI = 'mongodb://localhost:27017/fingerpaydb';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to DB');
  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  console.log('Registered Users in DB:');
  console.log(JSON.stringify(users.map(u => ({
    name: u.name,
    phone: u.phone,
    email: u.email,
    fpHash: u.fpHash,
    hasSecretCodeHash: !!u.secretCodeHash
  })), null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
