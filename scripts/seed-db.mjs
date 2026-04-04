#!/usr/bin/env node
/**
 * Seed Database Script
 * Initializes the SQLite database with default RSS sources for JARVIS
 * Run with: node scripts/seed-db.mjs
 */

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'jarvis.db');

const DEFAULT_SOURCES = [
  // News & General
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml', type: 'rss', intervalMinutes: 60 },
  { name: 'Reuters', url: 'https://feeds.reuters.com/reuters/topNews', type: 'rss', intervalMinutes: 60 },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', type: 'rss', intervalMinutes: 120 },
  { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml', type: 'rss', intervalMinutes: 120 },
  
  // Technology & AI
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', type: 'rss', intervalMinutes: 120 },
  { name: 'HackerNews', url: 'https://news.ycombinator.com/rss', type: 'rss', intervalMinutes: 120 },
  { name: 'ArXiv AI', url: 'http://arxiv.org/rss/cs.AI', type: 'rss', intervalMinutes: 240 },
  { name: 'ArXiv ML', url: 'http://arxiv.org/rss/cs.LG', type: 'rss', intervalMinutes: 240 },
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', type: 'rss', intervalMinutes: 240 },
  { name: 'DeepMind Blog', url: 'https://www.deepmind.com/blog/rss.xml', type: 'rss', intervalMinutes: 240 },
  
  // Science & Research
  { name: 'Nature', url: 'https://www.nature.com/nature.rss', type: 'rss', intervalMinutes: 240 },
  { name: 'Science Daily', url: 'https://www.sciencedaily.com/rss/all.xml', type: 'rss', intervalMinutes: 240 },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed.rss', type: 'rss', intervalMinutes: 120 },
  
  // Programming & Development
  { name: 'Dev.to', url: 'https://dev.to/api/articles?state=fresh&top=7', type: 'rss', intervalMinutes: 120 },
  { name: 'GitHub Trending', url: 'https://github.com/trending/typescript.rss', type: 'rss', intervalMinutes: 240 },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com/feeds/tag/javascript', type: 'rss', intervalMinutes: 120 },
];

async function seedDatabase() {
  try {
    console.log('🌱 Seeding SQLite database with default RSS sources...\n');

    // Initialize sql.js
    const SQL = await initSqlJs();

    // Load existing database or create new one
    let data;
    if (fs.existsSync(DB_PATH)) {
      data = fs.readFileSync(DB_PATH);
    }

    const db = new SQL.Database(data);

    // Check if sources already exist
    const existingResult = db.exec('SELECT COUNT(*) as count FROM scrape_sources');
    const existingCount = existingResult[0]?.values[0]?.[0] ?? 0;

    if (existingCount > 0) {
      console.log(`⚠️  Database already has ${existingCount} sources. Skipping seed.\n`);
      console.log('💡 To re-seed, delete jarvis.db and run this script again.\n');
      return;
    }

    // Insert sources
    for (const source of DEFAULT_SOURCES) {
      const stmt = db.prepare(`
        INSERT INTO scrape_sources (name, url, type, isActive, intervalMinutes, lastStatus, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.bind([
        source.name,
        source.url,
        source.type,
        1, // isActive
        source.intervalMinutes,
        'pending',
        Date.now(),
        Date.now(),
      ]);

      stmt.step();
      stmt.free();

      console.log(`✓ Added: ${source.name}`);
    }

    // Save database
    const data_out = db.export();
    const buffer = Buffer.from(data_out);
    fs.writeFileSync(DB_PATH, buffer);

    console.log(`\n✅ Database seeded successfully!`);
    console.log(`📡 Added ${DEFAULT_SOURCES.length} RSS sources`);
    console.log('💡 The scraper will run automatically every hour.');
    console.log(`📂 Database saved to: ${DB_PATH}\n`);
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  }
}

seedDatabase();
