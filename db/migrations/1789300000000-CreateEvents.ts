import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * SCAFFOLD (columns only) for Kata 07 — query performance.
 *
 * Deliberately ships WITHOUT the performance index: the table has only its
 * primary-key index, so the feed query `WHERE user_id = $1 ORDER BY created_at
 * DESC LIMIT n` must Seq Scan + Sort. Adding the covering composite index is
 * the learner's assignment — write a SECOND migration for it, do not edit this
 * one.
 */
export class CreateEvents1789300000000 implements MigrationInterface {
  name = 'CreateEvents1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'events',
        columns: [
          {
            name: 'id',
            type: 'bigint',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'user_id', type: 'int', isNullable: false },
          {
            name: 'created_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
          { name: 'kind', type: 'text', isNullable: false },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('events');
  }
}
