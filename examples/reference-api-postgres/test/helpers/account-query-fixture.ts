import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../dist/core/database/transaction-context.js';
import { AccountService } from '../../dist/modules/accounts/account.service.js';
import { accountTable } from '../../dist/modules/accounts/account.entity.js';

/** Exposes actual native SQL capabilities for grouped queries and joins. */
export class AccountQueryFixture extends AccountService {
  grouped(email: string, context?: TransactionContext) {
    return this.queryRows(
      sql<{
        enabled: boolean;
        count: number;
      }>`SELECT enabled, count(*)::integer AS count FROM ${accountTable} WHERE email = ${email} GROUP BY enabled ORDER BY enabled`,
      { context },
    );
  }
  joined(id: string) {
    // Native SQL self join: aliases are static owner-authored identifiers.
    return this.queryRows(
      sql<{
        id: string;
        peerId: string;
      }>`SELECT a.id AS id, b.id AS "peerId" FROM ${accountTable} AS a INNER JOIN ${accountTable} AS b ON a.email = b.email WHERE a.id = ${id} ORDER BY b.id`,
      { limit: 2 },
    );
  }
}
