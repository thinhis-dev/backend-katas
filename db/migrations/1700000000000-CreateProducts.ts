import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateProducts1700000000000 implements MigrationInterface {
  name = 'CreateProducts1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto provides gen_random_uuid() as a DB-side default for raw inserts.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await queryRunner.createTable(
      new Table({
        name: 'products',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'name', type: 'text', isNullable: false },
          { name: 'price_cents', type: 'int', isNullable: false },
          { name: 'stock', type: 'int', isNullable: false, default: 0 },
          { name: 'version', type: 'int', isNullable: false, default: 1 },
          {
            name: 'updated_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('products');
  }
}
