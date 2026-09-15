import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventsFeedIndex1789400000000 implements MigrationInterface {
  name = 'AddEventsFeedIndex1789400000000'

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`CREATE INDEX idx_events_user_created_id ON events (user_id, created_at DESC, id DESC)`)
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_events_user_created_id`)
  }
}
