import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * The one seed table. Deliberately carries the hooks the "hard middle" katas need:
 *  - stock (int)      -> race conditions / oversell (Week 2)
 *  - version          -> @VersionColumn optimistic locking, mirrors JPA @Version (Week 2)
 *  - priceCents (int) -> money as integer, never float (a senior habit)
 *  - updatedAt        -> cache-invalidation signal (Week 4)
 */
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'int', name: 'price_cents' })
  priceCents: number;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @VersionColumn()
  version: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
