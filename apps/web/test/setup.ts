import { randomUUID } from "node:crypto";

// Every run gets its own database; test/helpers.ts drops it. The routes read
// these through getDb() and requireEnv(), so they have to be set before import.
process.env.MONGODB_URI ??= process.env.MONGODB_TEST_URI ?? "mongodb://127.0.0.1:27017/?directConnection=true";
process.env.MONGODB_DB = `mg_web_test_${randomUUID().slice(0, 8)}`;
process.env.AUTH_SECRET = "test-auth-secret-not-for-real-use-0123456789";
process.env.DEVICE_TOKEN_SECRET = "test-device-secret-not-for-real-use-0123456789";
