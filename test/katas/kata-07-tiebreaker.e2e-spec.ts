import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * ============================================================================
 * KATA 07 — SUPPLEMENTAL DIAGNOSTIC: keyset tiebreaker + cursor termination
 * ============================================================================
 * This is NOT the graded contract (that is kata-07-query-performance.e2e-spec.ts,
 * which you must not edit). This file is a teaching aid you asked for: it targets
 * the two bugs the main spec CANNOT catch because it seeds every row with a
 * UNIQUE, 1-second-apart timestamp.
 *
 * It is safe to edit or delete. Run it with:
 *   npm run test:kata -- test/katas/kata-07-tiebreaker.e2e-spec.ts
 *
 * WHAT IT EXERCISES
 * -----------------
 * 1) EQUAL TIMESTAMPS (the tiebreaker). We seed 8 events at the SAME instant,
 *    then 1, then 8 more at another same instant — for one user. With a page size
 *    that cuts THROUGH a tie group, a keyset that compares only `created_at`
 *    (`created_at < cursor`) drops the whole tied block: created_at is not < the
 *    cursor, it's =, so the rest of the group is skipped forever (or the boundary
 *    row is re-served). The only fix is a total order: compare (created_at, id)
 *    and encode BOTH in the cursor, matching ORDER BY (created_at DESC, id DESC).
 *
 * 2) TERMINATION. Paging to the end must yield `nextCursor: null` so a
 *    `while (nextCursor)` loop stops. A cursor that is always a non-null string
 *    never terminates.
 *
 * 3) FILTER HOLDS UNDER TIES. Decoy rows for a DIFFERENT user share the newest
 *    instant, so if the user filter ever gets dropped they leak in right where
 *    the tiebreaker is under stress.
 * ============================================================================
 */

const TIE_USER = 900777;
const DECOY_USER = 900778;
const PAGE = 5;

// Three instants; the middle one has a single row so the run crosses a tie group
// boundary in both directions.
const T_NEW = '2020-06-01 00:00:02+00';
const T_MID = '2020-06-01 00:00:01+00';
const T_OLD = '2020-06-01 00:00:00+00';

const N_NEW = 8; // tied newest rows for TIE_USER
const N_OLD = 8; // tied oldest rows for TIE_USER
const N_DECOY = 5; // other user's rows at the newest instant
const EXPECTED_TOTAL = N_NEW + 1 + N_OLD; // 17

type FeedItem = { id: string | number; userId: number; createdAt: string; kind: string };

describe('Kata 07 — tiebreaker & cursor termination (supplemental)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  // Filled by the full page-walk in beforeAll so each `it` asserts one property.
  let collected: FeedItem[] = [];
  let seededIds: string[] = [];
  let pageCount = 0;
  let terminatedWithNull = false;

  const getFeed = async (
    query: Record<string, string | number>,
  ): Promise<{ items: FeedItem[]; nextCursor: string | null }> => {
    const res = await request(app.getHttpServer()).get('/events').query(query).expect(200);
    return res.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query('TRUNCATE TABLE events RESTART IDENTITY');
    // 8 tied newest rows for the graded user.
    await dataSource.query(
      `INSERT INTO events (user_id, created_at, kind)
       SELECT $1, timestamptz '${T_NEW}', 'tie-new' FROM generate_series(1, $2)`,
      [TIE_USER, N_NEW],
    );
    // 1 row at the middle instant.
    await dataSource.query(
      `INSERT INTO events (user_id, created_at, kind) VALUES ($1, timestamptz '${T_MID}', 'tie-mid')`,
      [TIE_USER],
    );
    // 8 tied oldest rows.
    await dataSource.query(
      `INSERT INTO events (user_id, created_at, kind)
       SELECT $1, timestamptz '${T_OLD}', 'tie-old' FROM generate_series(1, $2)`,
      [TIE_USER, N_OLD],
    );
    // Decoy rows for a different user at the newest instant — must never appear.
    await dataSource.query(
      `INSERT INTO events (user_id, created_at, kind)
       SELECT $1, timestamptz '${T_NEW}', 'decoy' FROM generate_series(1, $2)`,
      [DECOY_USER, N_DECOY],
    );
    await dataSource.query('ANALYZE events');

    const rows: Array<{ id: string }> = await dataSource.query(
      'SELECT id FROM events WHERE user_id = $1',
      [TIE_USER],
    );
    seededIds = rows.map((r) => String(r.id));

    // Walk every page by following nextCursor, exactly as a real client would.
    // The safety cap turns a never-null cursor (bug #2) into a clean failure
    // instead of an infinite loop.
    let cursor: string | null = null;
    const MAX_PAGES = 50;
    while (pageCount < MAX_PAGES) {
      const query: Record<string, string | number> = { userId: TIE_USER, limit: PAGE };
      if (cursor) query.cursor = cursor;
      const page = await getFeed(query);
      collected.push(...page.items);
      pageCount++;
      if (page.nextCursor === null) {
        terminatedWithNull = true;
        break;
      }
      cursor = page.nextCursor;
    }
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('terminates: paging to the end yields nextCursor === null', () => {
    // If this is false, the walk bailed out on the safety cap — the cursor never
    // became null, so a `while (nextCursor)` client would loop forever.
    expect(terminatedWithNull).toBe(true);
    expect(pageCount).toBeLessThan(50);
  });

  it('returns every row exactly once — no rows skipped across a tie group', () => {
    const ids = collected.map((i) => String(i.id));
    // No row was dropped: the collected set equals the seeded set.
    expect(new Set(ids)).toEqual(new Set(seededIds));
    // And the total matches (guards against a short walk that stops early).
    expect(ids).toHaveLength(EXPECTED_TOTAL);
  });

  it('never duplicates a row across pages', () => {
    const ids = collected.map((i) => String(i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a TOTAL order: (created_at DESC, id DESC), tiebreaker included', () => {
    const totalDesc = collected.every((row, i) => {
      if (i === 0) return true;
      const prev = collected[i - 1];
      const pt = new Date(prev.createdAt).getTime();
      const ct = new Date(row.createdAt).getTime();
      if (pt > ct) return true; // strictly newer -> fine
      if (pt < ct) return false; // jumped back in time -> wrong
      // equal timestamps: id must strictly descend. THIS is the tiebreaker under test.
      return Number(prev.id) > Number(row.id);
    });
    expect(totalDesc).toBe(true);
  });

  it('keeps the user filter under ties — no decoy user leaks in', () => {
    expect(collected.every((r) => Number(r.userId) === TIE_USER)).toBe(true);
  });
});
