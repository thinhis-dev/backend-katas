import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'text' })
  productId: string

  // should be FK with products table but not in idempotency scope
  @Column({ type: 'int' })
  quantity: number
}
