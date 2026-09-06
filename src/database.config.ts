import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * Base TypeORM connection options shared by the Nest runtime (app.module.ts) and
 * the CLI datasource (data-source.ts), so the connection never drifts. Env-driven
 * with local defaults matching docker-compose.yml (kata/kata/kata).
 *
 * NOTE: `migrations` is intentionally NOT here. The running app must not load
 * migration files (it never executes them, and requiring the .ts source under
 * compiled Node fails). The CLI datasource adds `migrations` itself.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'kata',
    password: process.env.DB_PASSWORD ?? 'kata',
    database: process.env.DB_NAME ?? 'kata',
    entities: [join(__dirname, '/**/*.entity.{ts,js}')],
    synchronize: false, // migrations only — never auto-sync (a habit worth keeping)
    logging: false,
  };
}
