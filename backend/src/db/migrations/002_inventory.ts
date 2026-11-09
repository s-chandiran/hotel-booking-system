import type { Knex } from "knex";
import { CREATED, fk, ID, ownedFks, PROPERTY, run, TABLE_OPTS, UPDATED, dropAll } from "../sql.js";

// DATABASE.md §3.2. Room operational status is NOT stored. Only is_out_of_service is (D2, DB5).
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE room_types (
  ${ID},
  ${PROPERTY},
  code VARCHAR(30) NOT NULL,
  name VARCHAR(80) NOT NULL,
  base_rate DECIMAL(12,2) NOT NULL,
  capacity TINYINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_room_types_code (property_id, code),
  CONSTRAINT ck_room_types_rate CHECK (base_rate > 0),
  CONSTRAINT ck_room_types_capacity CHECK (capacity >= 1),
  ${ownedFks("room_types").join(",\n  ")}
) ${TABLE_OPTS}`,
    `CREATE TABLE rooms (
  ${ID},
  ${PROPERTY},
  room_type_id BIGINT UNSIGNED NOT NULL,
  number VARCHAR(10) NOT NULL,
  floor SMALLINT NULL,
  is_out_of_service BOOLEAN NOT NULL DEFAULT FALSE,
  housekeeping_status ENUM('clean','dirty','inspecting') NOT NULL DEFAULT 'clean',
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_rooms_number (property_id, number),
  ${fk("rooms", "room_type_id", "room_types")},
  ${ownedFks("rooms").join(",\n  ")}
) ${TABLE_OPTS}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropAll(knex, "rooms", "room_types");
}
