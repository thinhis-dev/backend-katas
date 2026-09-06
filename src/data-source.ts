import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './database.config';

// Load .env for CLI contexts (migrations, seed). No-op if the file is absent —
// buildDataSourceOptions() falls back to local defaults.
config();

// TypeORM CLI requires a file with exactly ONE DataSource export — keep this as
// the sole (default) export. Import it as `import AppDataSource from './data-source'`.
const AppDataSource = new DataSource(buildDataSourceOptions());
export default AppDataSource;
