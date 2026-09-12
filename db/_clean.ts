import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { Product } from '../src/products/product.entity';

config();

/**
 * One-off: remove kata-02 concurrency-test leftovers (throwaway products named
 * `kata02-*`, drained to stock 0) that pollute `ORDER BY name ASC` and make
 * kata-04's `anyProductId()` pick an exhausted product. Safe to delete + rerun.
 */
(async () => {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Product);
  const del = await repo
    .createQueryBuilder()
    .delete()
    .from(Product)
    .where('name LIKE :p', { p: 'kata02-%' })
    .execute();
  console.log('deleted kata02 rows:', del.affected);
  const rows = await repo.find({ order: { name: 'ASC' }, take: 3 });
  for (const r of rows) console.log('first-by-name:', r.name, 'stock=', r.stock);
  console.log('total now:', await repo.count());
  await AppDataSource.destroy();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
