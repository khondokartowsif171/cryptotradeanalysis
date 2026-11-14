import { MongoClient } from 'mongodb';

export function normalizeMongoUri(rawUri?: string): string {
  const trimmed = (rawUri || '').trim();
  if (!trimmed) return 'mongodb://localhost:27017';
  if (trimmed.includes('@') && !/[?&]authSource=/i.test(trimmed)) {
    const separator = trimmed.includes('?') ? '&' : '?';
    return `${trimmed}${separator}authSource=admin`;
  }
  return trimmed;
}

const dbName = process.env.MONGO_DB || 'cryptox';

let client: MongoClient | null = null;
let db: ReturnType<MongoClient['db']> | null = null;

export async function getMongo() {
  if (db) return db;
  const uri = normalizeMongoUri(process.env.MONGO_URL);
  const nextClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  try {
    await nextClient.connect();
    await nextClient.db(dbName).command({ ping: 1 });
    client = nextClient;
    db = nextClient.db(dbName);
    return db;
  } catch (err) {
    client = null;
    db = null;
    await nextClient.close().catch(() => {});
    throw err;
  }
}

export async function pingMongo(): Promise<{ connected: boolean; error?: string }> {
  try {
    const database = await getMongo();
    await database.command({ ping: 1 });
    return { connected: true };
  } catch (err: any) {
    db = null;
    return { connected: false, error: err?.message || 'MongoDB unavailable' };
  }
}

export async function closeMongo() {
  db = null;
  if (client) {
    await client.close().catch(() => {});
    client = null;
  }
}
