import type { Knex } from "knex";
import { CREATED, fk, ID, ownedFks, PROPERTY, run, TABLE_OPTS, UPDATED, dropAll } from "../sql.js";

// DATABASE.md §3.3. Guest PII columns are never logged. Retention and ID-document fields wait for Q19.
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE guests (
  ${ID},
  ${PROPERTY},
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NULL,
  phone VARCHAR(40) NULL,
  country_code CHAR(2) NULL,
  is_vip BOOLEAN NOT NULL DEFAULT FALSE,
  ${CREATED},
  ${UPDATED},
  KEY ix_guests_name (property_id, full_name),
  ${ownedFks("guests").join(",\n  ")}
) ${TABLE_OPTS}`,
    `CREATE TABLE bookings (
  ${ID},
  ${PROPERTY},
  reference VARCHAR(20) NOT NULL,
  guest_id BIGINT UNSIGNED NOT NULL,
  room_type_id BIGINT UNSIGNED NOT NULL,
  room_id BIGINT UNSIGNED NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  guests_count TINYINT UNSIGNED NOT NULL,
  source ENUM('direct','booking_com','expedia','walk_in','phone') NOT NULL,
  status ENUM('pending','confirmed','checked_in','checked_out','cancelled') NOT NULL,
  nightly_rate DECIMAL(12,2) NOT NULL,
  room_total DECIMAL(12,2) NOT NULL,
  expected_arrival_time TIME NULL,
  checked_in_at DATETIME(3) NULL,
  checked_out_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  cancellation_reason VARCHAR(500) NULL,
  -- R2/R8 backstop: at most one checked-in booking per room (unique index ignores NULLs).
  occupied_room_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status = 'checked_in', room_id, NULL)) STORED,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_bookings_reference (property_id, reference),
  UNIQUE KEY uq_bookings_occupied_room (occupied_room_id),
  KEY ix_bookings_check_in (property_id, check_in_date),
  KEY ix_bookings_check_out (property_id, check_out_date),
  KEY ix_bookings_room_dates (room_id, check_in_date, check_out_date),
  KEY ix_bookings_guest (guest_id),
  CONSTRAINT ck_bookings_dates CHECK (check_out_date > check_in_date),
  CONSTRAINT ck_bookings_guests CHECK (guests_count >= 1),
  CONSTRAINT ck_bookings_rate CHECK (nightly_rate > 0),
  CONSTRAINT ck_bookings_total CHECK (room_total > 0),
  CONSTRAINT ck_bookings_room_for_stay CHECK (status NOT IN ('checked_in','checked_out') OR room_id IS NOT NULL),
  ${fk("bookings", "guest_id", "guests")},
  ${fk("bookings", "room_type_id", "room_types")},
  ${fk("bookings", "room_id", "rooms")},
  ${ownedFks("bookings").join(",\n  ")}
) ${TABLE_OPTS}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await dropAll(knex, "bookings", "guests");
}
