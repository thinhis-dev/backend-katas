import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { Product } from '../src/products/product.entity';

config();

/**
 * Idempotent seed: inserts ~100 products only if the table is under 100 rows,
 * so it is safe to run on every devcontainer boot (postCreateCommand).
 */
async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Product);

  const existing = await repo.count();
  if (existing >= 100) {
    // eslint-disable-next-line no-console
    console.log(`Seed skipped: ${existing} products already present.`);
    await AppDataSource.destroy();
    return;
  }

  const rows: Partial<Product>[] = [];
  for (let i = 1; i <= 100; i++) {
    rows.push({
      name: `Product ${String(i).padStart(3, '0')}`,
      priceCents: 500 + i * 10,
      stock: (i % 10) + 1, // 1..10, so "last item" scenarios exist for Week 2
    });
  }
  await repo.save(rows);
  // eslint-disable-next-line no-console
  console.log(`Seeded ${rows.length} products.`);
  await AppDataSource.destroy();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
