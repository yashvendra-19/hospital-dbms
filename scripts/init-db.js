/**
 * Centralized Hospital Bed & Emergency Resource Management System (CHR-MS)
 * Automated Database Provisioning & Schema Initialization Script
 * Usage: npm run db:setup (or node scripts/init-db.js)
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadDatasets } = require('./load-datasets');

// Custom robust parser for .env / .env.local without external dependencies
function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  const env = {};

  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      console.log(`[Env] Loading configuration from ${file}...`);
      const lines = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (env[key] === undefined) {
            env[key] = val;
          }
        }
      }
    }
  }
  return env;
}

const parsedEnv = loadEnv();

// Connection parameters with priority: process.env > parsedEnv > fallback defaults
const DB_HOST = process.env.DB_HOST || parsedEnv.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || parsedEnv.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || parsedEnv.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || parsedEnv.DB_PASSWORD || 'postgres';
const DB_NAME = process.env.DB_NAME || parsedEnv.DB_NAME || 'hospital_db';

console.log('\n============================================================');
console.log(' HOSPITAL BED MANAGEMENT SYSTEM - DATABASE SETUP RUNNER');
console.log('============================================================');
console.log(`Target Host : ${DB_HOST}:${DB_PORT}`);
console.log(`Target User : ${DB_USER}`);
console.log(`Target DB   : ${DB_NAME}`);
console.log('------------------------------------------------------------\n');

async function initializeDatabase() {
  // Step 1: Connect to default 'postgres' database to check/create the target database
  console.log(`[Step 1/5] Connecting to administrative database "postgres"...`);
  const adminClient = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
  });

  try {
    await adminClient.connect();
    console.log(`[Step 1/5] Connected to "postgres" successfully.`);

    // Check if target database exists
    console.log(`[Step 2/5] Checking existence of database "${DB_NAME}"...`);
    const checkDbRes = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [DB_NAME]
    );

    if (checkDbRes.rows.length === 0) {
      console.log(`[Step 2/5] Database "${DB_NAME}" not found. Creating database...`);
      // Escape identifier safely
      await adminClient.query(`CREATE DATABASE "${DB_NAME.replace(/"/g, '""')}";`);
      console.log(`[Step 2/5] Database "${DB_NAME}" created successfully!`);
    } else {
      console.log(`[Step 2/5] Database "${DB_NAME}" already exists.`);
    }
  } catch (err) {
    console.error(`\n[FATAL ERROR] Could not connect to PostgreSQL on ${DB_HOST}:${DB_PORT}.`);
    console.error(`Detail: ${err.message}`);
    console.error(`\nPlease ensure that:`);
    console.error(`  1. PostgreSQL server is running on ${DB_HOST}:${DB_PORT}`);
    console.error(`  2. Password in .env / .env.local matches your PostgreSQL postgres user password.\n`);
    process.exit(1);
  } finally {
    await adminClient.end();
  }

  // Step 3: Connect directly to hospital_db
  console.log(`\n[Step 3/5] Connecting to "${DB_NAME}" to run schema migrations...`);
  const appClient = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await appClient.connect();
    console.log(`[Step 3/5] Connected to "${DB_NAME}".`);

    // Step 4: Read and execute setup_hospital_db.sql
    const sqlPath = path.resolve(__dirname, '..', 'database', 'setup_hospital_db.sql');
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`SQL setup file not found at: ${sqlPath}`);
    }

    console.log(`[Step 4/5] Executing ${sqlPath}...`);
    const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

    const startTime = Date.now();
    await appClient.query(sqlContent);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Step 4/5] Schema and seed data successfully initialized in ${duration}s!`);

    console.log('\n[Step 5/5] Loading real-world datasets from database/datasets/ ...');
    await loadDatasets(appClient);

    // Verification summary of table row counts
    console.log('\n============================================================');
    console.log(' DATABASE VERIFICATION SUMMARY');
    console.log('============================================================');

    const tables = [
      'departments',
      'doctors',
      'wards_beds',
      'patients',
      'admissions',
      'medical_equipments',
      'billing',
      'bed_transfer_audit',
      'staff_accounts',
      'staff_sessions',
      'login_audit',
      'dataset_sources',
      'nhp_hospitals',
      'india_pincodes',
      'hospital_profile',
      'condition_catalog',
      'historical_discharges',
      'insurance_schemes',
      'cost_estimates',
      'ambulance_prealerts',
      'bed_holds',
      'audit_chain',
      'audit_tamper_drill',
    ];

    for (const table of tables) {
      const res = await appClient.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      const padTable = table.padEnd(22, ' ');
      console.log(`  Table: ${padTable} -> ${res.rows[0].count} records`);
    }

    // Verify Views
    const viewRes = await appClient.query(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name`
    );
    console.log('\n  Operational Views Ready:');
    for (const row of viewRes.rows) {
      console.log(`    * ${row.table_name}`);
    }

    // Verify GiST exclusion constraint
    const gistRes = await appClient.query(`
      SELECT conname FROM pg_constraint 
      WHERE conname = 'ex_no_double_bed_booking'
    `);
    if (gistRes.rows.length > 0) {
      console.log('\n  GiST Temporal Constraint: ex_no_double_bed_booking [ACTIVE & VERIFIED]');
    }

    const rls = await appClient.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`
    );
    console.log(`  Row-level security policies: ${rls.rows[0].n} active`);
    const chain = await appClient.query('SELECT * FROM fn_verify_audit_chain()');
    const c = chain.rows[0];
    console.log(`  Audit chain: ${c.verified_rows}/${c.total_rows} rows verified, head #${c.head_seq} ${String(c.head_hash).slice(0, 16)}...`);

    console.log('============================================================');
    console.log(' READY FOR CLINICAL WORKLOAD & FACULTY EVALUATION');
    console.log(' Start application with: npm run dev');
    console.log('============================================================\n');

  } catch (err) {
    console.error(`\n[FATAL ERROR] Failed while applying SQL schema snapshot:`, err);
    process.exit(1);
  } finally {
    await appClient.end();
  }
}

initializeDatabase();
