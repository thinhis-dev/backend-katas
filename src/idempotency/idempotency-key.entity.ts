import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn('uuid')
  key: string

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, unknown>

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date
}
