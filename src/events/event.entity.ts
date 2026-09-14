import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * An append-only activity feed row (Week 7 — query performance).
 *
 * SCAFFOLD ONLY: columns, no performance index. The whole kata is that a feed
 * query — "the newest N events for one user" — is a SEQ SCAN + SORT over the
 * whole table until you add the right composite index, and OFFSET paging over
 * it silently duplicates rows the moment a new event arrives. Adding the index
 * (a migration) and switching OFFSET -> keyset/cursor paging is your job.
 *
 * NOTE: @Index on the entity does nothing here — synchronize is false, so the
 * schema comes from migrations only. Add the index in a migration.
 */
@Entity('events')
export class Event {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'int', name: 'user_id' })
  userId: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'text' })
  kind: string;
}
