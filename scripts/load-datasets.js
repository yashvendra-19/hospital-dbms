/**
 * Loads the real-world dataset extracts in database/datasets/ into hospital_db.
 * Called by scripts/init-db.js after the schema is created. No extra npm packages needed.
 *
 *   nhp_hospital_directory.csv.gz -> nhp_hospitals        (National Hospital Directory, Govt. of India)
 *   india_pincodes.csv.gz         -> india_pincodes       (India Post pincode centroids)
 *   sparcs_2021_sample.csv.gz     -> historical_discharges (NY SPARCS 2021 de-identified stays)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = path.resolve(__dirname, '..', 'database', 'datasets');
const BATCH = 2000;

/** Minimal RFC 4180 CSV parser (handles quotes, escaped quotes and commas inside fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return { header, data };
}

function readGzCsv(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, file)));
  return parseCsv(buf.toString('utf-8'));
}

/** Batched INSERT ... SELECT FROM unnest(...) : one round trip per 2,000 rows. */
async function bulkInsert(client, table, columns, types, rows) {
  for (let start = 0; start < rows.length; start += BATCH) {
    const chunk = rows.slice(start, start + BATCH);
    const arrays = columns.map((_, c) => chunk.map((r) => (r[c] === '' || r[c] === undefined ? null : r[c])));
    const unnest = types.map((t, i) => `$${i + 1}::${t}[]`).join(', ');
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) SELECT * FROM unnest(${unnest})`, arrays);
  }
  return rows.length;
}

function pick(header, data, columns) {
  const idx = columns.map((c) => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error(`Column ${c} missing from dataset`);
    return i;
  });
  return data.map((r) => idx.map((i) => r[i]));
}

async function loadDatasets(client, log = console.log) {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    log('  [Datasets] database/datasets/manifest.json not found; skipping real-world data.');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  for (const [key, m] of Object.entries(manifest)) {
    await client.query(
      `INSERT INTO dataset_sources (source_key, title, publisher, source_url, mirror_url, licence, raw_sha256,
                                    rows_in_source, rows_loaded, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
      [key, m.title, m.publisher, m.url, m.mirror_url || null, m.licence || null, m.raw_sha256 || null, m.rows_in_source ?? null, m.notes || null]
    );
  }

  // 1. National Hospital Directory
  let t = Date.now();
  const nhpCols = ['nhp_sr_no', 'hospital_name', 'hospital_category', 'care_type', 'discipline', 'address', 'state', 'district',
    'pincode', 'telephone', 'mobile', 'emergency_phone', 'ambulance_phone', 'bloodbank_phone', 'specialties', 'facilities',
    'total_beds', 'emergency_services', 'latitude', 'longitude', 'geo_source'];
  const nhp = readGzCsv('nhp_hospital_directory.csv.gz');
  const nhpRows = pick(nhp.header, nhp.data, nhpCols);
  const nNhp = await bulkInsert(
    client,
    'nhp_hospitals',
    ['nhp_id', ...nhpCols.slice(1)],
    ['int', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
      'text', 'int', 'text', 'numeric', 'numeric', 'text'],
    nhpRows
  );
  await client.query(`UPDATE dataset_sources SET rows_loaded = $1 WHERE source_key = 'nhp_hospital_directory'`, [nNhp]);
  log(`  [Datasets] nhp_hospitals          <- ${nNhp.toLocaleString('en-IN')} real hospitals (${Date.now() - t} ms)`);

  // 2. Pincode centroids
  t = Date.now();
  const pinCols = ['pincode', 'locality', 'district', 'state', 'latitude', 'longitude', 'post_offices'];
  const pins = readGzCsv('india_pincodes.csv.gz');
  const nPins = await bulkInsert(client, 'india_pincodes', pinCols,
    ['text', 'text', 'text', 'text', 'numeric', 'numeric', 'int'], pick(pins.header, pins.data, pinCols));
  await client.query(`UPDATE dataset_sources SET rows_loaded = $1 WHERE source_key = 'india_pincode_geo'`, [nPins]);
  log(`  [Datasets] india_pincodes         <- ${nPins.toLocaleString('en-IN')} pincodes (${Date.now() - t} ms)`);

  // 3. SPARCS real hospital stays
  t = Date.now();
  const hCols = ['condition_id', 'ccsr_dx_code', 'facility_name', 'region', 'age_group', 'gender', 'admission_type',
    'ed_admission', 'severity_code', 'mortality_risk', 'medical_surgical', 'length_of_stay', 'disposition_group',
    'died_in_hospital', 'payment_type', 'total_charges_usd', 'total_costs_usd'];
  const sp = readGzCsv('sparcs_2021_sample.csv.gz');
  const spRows = pick(sp.header, sp.data, hCols).map((r) => ['sparcs_2021', ...r]);
  const nSp = await bulkInsert(client, 'historical_discharges', ['source_key', ...hCols],
    ['text', 'int', 'text', 'text', 'text', 'text', 'text', 'text', 'bool', 'smallint', 'text', 'text', 'smallint', 'text',
      'bool', 'text', 'numeric', 'numeric'], spRows);
  await client.query(`UPDATE dataset_sources SET rows_loaded = $1 WHERE source_key = 'sparcs_2021'`, [nSp]);
  const pops = (manifest.sparcs_2021 && manifest.sparcs_2021.population_by_condition) || {};
  for (const [cid, pop] of Object.entries(pops)) {
    await client.query('UPDATE condition_catalog SET source_population = $1 WHERE condition_id = $2', [pop, parseInt(cid, 10)]);
  }
  log(`  [Datasets] historical_discharges  <- ${nSp.toLocaleString('en-IN')} real hospital stays (${Date.now() - t} ms)`);

  t = Date.now();
  await client.query('REFRESH MATERIALIZED VIEW mv_condition_benchmarks');
  await client.query('ANALYZE nhp_hospitals; ANALYZE india_pincodes; ANALYZE historical_discharges;');
  const { rows } = await client.query('SELECT count(*)::int AS n FROM mv_condition_benchmarks');
  log(`  [Datasets] mv_condition_benchmarks refreshed: ${rows[0].n} benchmark rows (${Date.now() - t} ms)`);
}

module.exports = { loadDatasets, parseCsv };

if (require.main === module) {
  console.error('Run "npm run db:setup" instead: it creates the schema and then loads these datasets.');
  process.exit(1);
}
