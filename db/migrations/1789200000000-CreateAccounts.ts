import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateAccounts1789200000000 implements MigrationInterface {
  name = 'CreateAccounts1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'accounts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'name', type: 'text', isNullable: false },
          { name: 'balance_cents', type: 'int', isNullable: false, default: 0 },
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
    await queryRunner.dropTable('accounts');
  }
}
