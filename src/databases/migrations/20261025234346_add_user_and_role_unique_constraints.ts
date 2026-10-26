import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const duplicateEmail = await knex('users')
    .select('email')
    .count('* as duplicateCount')
    .groupBy('email')
    .havingRaw('COUNT(*) > 1')
    .first();

  if (duplicateEmail) {
    throw new Error(
      'Cannot add unique email constraint: duplicate user emails exist. Resolve them before rerunning this migration.'
    );
  }

  const duplicateUserRole = await knex('user_roles')
    .select('userId', 'roleId')
    .count('* as duplicateCount')
    .groupBy('userId', 'roleId')
    .havingRaw('COUNT(*) > 1')
    .first();

  if (duplicateUserRole) {
    throw new Error(
      'Cannot add unique user-role constraint: duplicate assignments exist. Resolve them before rerunning this migration.'
    );
  }

  await knex.schema.alterTable('users', (table) => {
    table.unique(['email'], 'users_email_unique');
  });

  await knex.schema.alterTable('user_roles', (table) => {
    table.unique(['userId', 'roleId'], 'user_roles_user_role_unique');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_roles', (table) => {
    table.dropUnique(['userId', 'roleId'], 'user_roles_user_role_unique');
  });

  await knex.schema.alterTable('users', (table) => {
    table.dropUnique(['email'], 'users_email_unique');
  });
}
