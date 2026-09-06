import 'reflect-metadata';
import { join } from 'path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.config';

// Load .env for CLI contexts (migrations, seed). No-op if the file is absent —
// buildDataSourceOptions() falls back to local defaults.
config();

// TypeORM CLI requires a file with exactly ONE DataSource export — keep this as
// the sole (default) export. Import it as `import AppDataSource from './data-source'`.
// `migrations` lives here (CLI only), never in the app runtime options, so the
// running app never tries to require the migration .ts files.
const AppDataSource = new DataSource({
  ...buildDataSourceOptions(),
  migrations: [join(__dirname, '/../db/migrations/*.{ts,js}')],
});
export default AppDataSource;
