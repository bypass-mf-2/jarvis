import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;

export default defineConfig({
  schema: connectionString ? "./drizzle/schema.ts" : "./drizzle/schema-sqlite.ts",
  out: "./drizzle",
  dialect: connectionString ? "mysql" : "sqlite",
  dbCredentials: connectionString
    ? { url: connectionString }
    : { url: "file:./jarvis.db" },
});
