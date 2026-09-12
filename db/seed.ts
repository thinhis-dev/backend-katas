import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { Product } from '../src/products/product.entity';

config();

/**
 * Refreshing seed: guarantees the 100 canonical `Product NNN` rows exist AND
 * resets each one's stock to its baseline on every run. Keyed by name, so
 * existing rows keep their id — it just re-tops the stock. This is deliberate:
 * the katas *purchase* stock (kata-02 concurrency, kata-04 invalidation), and a
 * once-only insert leaves those products drained to 0 forever, which then breaks
 * later runs at `expect(stock).toBeGreaterThan(0)`. Safe to run on every boot.
 */
async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Product);

  let inserted = 0;
  let refreshed = 0;
  for (let i = 1; i <= 100; i++) {
    const name = `Product ${String(i).padStart(3, '0')}`;
    const baselineStock = (i % 10) + 1; // 1..10, so "last item" scenarios exist for Week 2
    const priceCents = 500 + i * 10;

    const existing = await repo.findOne({ where: { name } });
    if (existing) {
      existing.stock = baselineStock;
      existing.priceCents = priceCents;
      await repo.save(existing);
      refreshed++;
    } else {
      await repo.save(repo.create({ name, priceCents, stock: baselineStock }));
      inserted++;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Seed done: ${inserted} inserted, ${refreshed} stock-refreshed.`);
  await AppDataSource.destroy();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
