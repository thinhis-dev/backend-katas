import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * Single source of TypeORM connection options, shared by the Nest runtime
 * (app.module.ts) and the TypeORM CLI datasource (data-source.ts) so migrations
 * and the app never drift apart. Env-driven with sane local defaults that match
 * docker-compose.yml (kata/kata/kata).
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
    migrations: [join(__dirname, '/../db/migrations/*.{ts,js}')],
    synchronize: false, // migrations only — never auto-sync (a habit worth keeping)
    logging: false,
  };
}
