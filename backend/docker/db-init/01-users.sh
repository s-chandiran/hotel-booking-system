#!/bin/bash
# Runs once, as root, when the MySQL data volume is first initialised (docker-entrypoint-initdb.d).
# Creates the two least-privilege users (DATABASE.md §6):
#   migrator: owns DDL on the schema and holds GRANT OPTION, used only by `migrate`
#   app:      no privileges here; migration 010_app_grants gives it exactly what it needs
# Passwords come from the environment (.env) and must not contain a single quote.
set -euo pipefail
: "${MYSQL_DATABASE:?}" "${DB_MIGRATOR_USER:?}" "${DB_MIGRATOR_PASSWORD:?}" "${DB_APP_USER:?}" "${DB_APP_PASSWORD:?}"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS '${DB_MIGRATOR_USER}'@'%' IDENTIFIED BY '${DB_MIGRATOR_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${DB_MIGRATOR_USER}'@'%' WITH GRANT OPTION;
CREATE USER IF NOT EXISTS '${DB_APP_USER}'@'%' IDENTIFIED BY '${DB_APP_PASSWORD}';
FLUSH PRIVILEGES;
SQL
