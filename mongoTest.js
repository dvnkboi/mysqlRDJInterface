const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');
 
// Connection URL
const url = 'mongodb://localhost:27017';
 
// Database Name
const dbName = 'myproject';
 

(async () => {
    // Use connect method to connect to the server
    let client = await MongoClient.connect(url);

    console.log("Connected successfully to server");

    const db = await client.db(dbName);
    const collection = await db.collection('artists');
    await collection.insertMany([
        {'travis_scott':'bruh'},
        {'travis_burger':'bruh'},
        {'travis_bruh':'bruhHHHh'},
    ]);
    const artists = await collection.find({'travis_scott':'bruh'}).toArray();
    console.log(artists);
    client.close();
})();
