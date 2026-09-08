import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * Week 3 seed table: two of these rows are the "both change or neither" pair a
 * transfer must move atomically. Columns only — the transfer service/logic is
 * the learner's to write.
 *
 *  - balanceCents (int) -> money as integer, never float
 *  - version            -> @VersionColumn, mirrors JPA @Version (optional locking hook)
 *  - updatedAt          -> last-touched signal
 */
@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'int', name: 'balance_cents' })
  balanceCents: number;

  @VersionColumn()
  version: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
