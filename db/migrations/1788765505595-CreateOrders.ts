import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOrders1788765505595 implements MigrationInterface {
    name = 'CreateOrders1788765505595'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" text NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("key" uuid NOT NULL, "result" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0afd83cbf08c9d12089a9bffc5e" PRIMARY KEY ("key"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP TABLE "orders"`);
    }

}
