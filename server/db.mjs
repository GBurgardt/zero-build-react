// MongoDB connection and collections
import { MongoClient } from 'mongodb';

let mongoClient = null;
let ideasCollection = null;

export async function getCollections(MONGO_URI) {
  if (!ideasCollection && MONGO_URI) {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const dbName = new URL(MONGO_URI).pathname.replace(/^\//, '') || 'zerodb';
    const db = mongoClient.db(dbName);
    ideasCollection = db.collection('ideas');
    try { 
      await ideasCollection.createIndex({ createdAt: -1 }); 
    } catch (_) {}
  }
  return { ideas: ideasCollection };
}

export { mongoClient };