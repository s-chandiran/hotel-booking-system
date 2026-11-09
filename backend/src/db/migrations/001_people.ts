import type { Knex } from "knex";
import { CREATED, fk, ID, PROPERTY, run, TABLE_OPTS, UPDATED, dropAll } from "../sql.js";

// DATABASE.md §3.1: properties, staff_members (the person), user_accounts (the login). D3.
export async function up(knex: Knex): Promise<void> {
  await run(
    knex,
    `CREATE TABLE properties (
  ${ID},
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(500) NOT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(254) NULL,
  country_code CHAR(2) NOT NULL,
  currency CHAR(3) NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  check_in_time TIME NOT NULL,
  check_out_time TIME NOT NULL,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_properties_code (code)
) ${TABLE_OPTS}`,
    `CREATE TABLE staff_members (
  ${ID},
  ${PROPERTY},
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NULL,
  job_title VARCHAR(60) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ${CREATED},
  ${UPDATED},
  KEY ix_staff_members_property (property_id),
  ${fk("staff_members", "property_id", "properties")}
) ${TABLE_OPTS}`,
    `CREATE TABLE user_accounts (
  ${ID},
  ${PROPERTY},
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('front_desk','admin','super_admin') NOT NULL,
  staff_member_id BIGINT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME(3) NULL,
  ${CREATED},
  ${UPDATED},
  UNIQUE KEY uq_user_accounts_username (property_id, username),
  UNIQUE KEY uq_user_accounts_staff (staff_member_id),
  ${fk("user_accounts", "property_id", "properties")},
  ${fk("user_accounts", "staff_member_id", "staff_members")},
  ${fk("user_accounts", "created_by_user_id", "user_accounts")}
) ${TABLE_OPTS}`,
    // created_by FKs that could only be added once user_accounts exists.
    `ALTER TABLE properties ADD ${fk("properties", "created_by_user_id", "user_accounts")}`,
    `ALTER TABLE staff_members ADD ${fk("staff_members", "created_by_user_id", "user_accounts")}`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await run(knex, "ALTER TABLE properties DROP FOREIGN KEY fk_properties_created_by_user_id", "ALTER TABLE staff_members DROP FOREIGN KEY fk_staff_members_created_by_user_id");
  await dropAll(knex, "user_accounts", "staff_members", "properties");
}
