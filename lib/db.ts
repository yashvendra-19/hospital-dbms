import { Pool, PoolConfig } from 'pg';

let poolConfig: PoolConfig;

if (process.env.DB_PASSWORD) {
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'hospital_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
} else if (process.env.DATABASE_URL) {
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
} else {
  // Default fallback for this local hospital_db setup
  poolConfig = {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'Shams@1234',
    database: 'hospital_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

// Global singleton pool for development hot-reloading
declare global {
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined;
}

function createPool() {
  const p = new Pool(poolConfig);
  p.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]: Unexpected error on idle client', err);
  });
  return p;
}

// Reuse one pool across hot reloads so listeners and connections do not pile up
const pool: Pool = global.__dbPool || createPool();

if (process.env.NODE_ENV !== 'production') {
  global.__dbPool = pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`[SQL Query] (${duration}ms):`, text.trim().slice(0, 100), params || '');
    }
    return { rows: res.rows, rowCount: res.rowCount };
  } catch (error: any) {
    console.error(`[SQL Error] in query:`, text, params, error?.message);
    throw error;
  }
}

export interface Db {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }>;
  /** Runs inside a savepoint. Returns null (instead of failing the request) when PostgreSQL denies access. */
  tryQuery<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null } | null>;
}

export interface DbIdentity {
  sessionId: number;
  staffId: number;
  staffCode: string;
  role: 'Doctor' | 'Nurse' | 'Admin' | 'Billing';
  mode: 'standard' | 'break_glass';
  doctorId: number | null;
}

/** PostgreSQL role used for each staff role (created in database/setup_hospital_db.sql, section 8). */
export const DB_ROLE: Record<DbIdentity['role'], string> = {
  Doctor: 'mr_doctor',
  Nurse: 'mr_nurse',
  Billing: 'mr_billing',
  Admin: 'mr_admin',
};

/**
 * Runs `work` in one transaction as the signed-in staff member:
 *   SET LOCAL ROLE mr_<role> + app.* settings, so grants, row-level security and the audit chain
 *   all see who is acting. Everything commits together or rolls back together.
 */
export async function asStaff<T>(who: DbIdentity, work: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let sp = 0;
  const log = (text: string, start: number, params?: any[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[SQL ${DB_ROLE[who.role]}] (${Date.now() - start}ms):`, text.trim().slice(0, 100), params || '');
    }
  };
  const db: Db = {
    async query(text, params) {
      const start = Date.now();
      const res = await client.query(text, params);
      log(text, start, params);
      return { rows: res.rows, rowCount: res.rowCount };
    },
    async tryQuery(text, params) {
      const name = `sp_${++sp}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const res = await client.query(text, params);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return { rows: res.rows, rowCount: res.rowCount };
      } catch (error: any) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        if (error?.code === '42501') return null;
        throw error;
      }
    },
  };
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.staff_id', $1, true), set_config('app.staff_code', $2, true),
              set_config('app.staff_role', $3, true), set_config('app.access_mode', $4, true),
              set_config('app.doctor_id', $5, true), set_config('app.session_id', $6, true)`,
      [String(who.staffId), who.staffCode, who.role, who.mode, who.doctorId ? String(who.doctorId) : '', String(who.sessionId)]
    );
    await client.query(`SET LOCAL ROLE ${DB_ROLE[who.role]}`);
    // Lazy expiry of ambulance bed holds whose time window has ended (SECURITY DEFINER, cheap when idle)
    await client.query('SELECT fn_release_expired_holds()');
    const result = await work(db);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export { pool, poolConfig };
export default pool;
