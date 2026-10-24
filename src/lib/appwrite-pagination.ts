import { Query } from "node-appwrite";

import { appConfig } from "./config";
import { tablesDB } from "./appwrite";

export type AppwriteRow = Record<string, unknown>;

export interface PaginationOptions {
  pageSize?: number;
  maxRows?: number;
}

export async function listAllTableRows(
  tableId: string,
  additionalQueries: string[] = [],
  options: PaginationOptions = {},
): Promise<AppwriteRow[]> {
  const pageSize = options.pageSize ?? 100;
  const maxRows = options.maxRows ?? 10_000;

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error("Page size must be an integer between 1 and 500.");
  }

  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("maxRows must be a positive integer.");
  }

  const collected: AppwriteRow[] = [];
  let cursor: string | undefined;

  while (true) {
    const remaining = maxRows - collected.length;
    const requestedLimit = Math.min(pageSize, remaining + 1);

    const queries = [
      ...additionalQueries,
      Query.orderAsc("$id"),
      Query.limit(requestedLimit),
      ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ];

    const response = await tablesDB.listRows({
      databaseId: appConfig.databaseId,
      tableId,
      queries,
    });

    const rows = response.rows as unknown as AppwriteRow[];

    if (collected.length + rows.length > maxRows) {
      throw new Error(
        `Table "${tableId}" exceeded the configured ${maxRows}-row safety limit. ` +
          "Increase the limit deliberately or use a narrower query.",
      );
    }

    collected.push(...rows);

    if (rows.length < requestedLimit) {
      return collected;
    }

    const lastRow = rows[rows.length - 1];
    const nextCursor = lastRow?.$id;

    if (typeof nextCursor !== "string" || !nextCursor) {
      throw new Error(
        `Could not continue pagination for table "${tableId}".`,
      );
    }

    if (nextCursor === cursor) {
      throw new Error(
        `Pagination cursor did not advance for table "${tableId}".`,
      );
    }

    cursor = nextCursor;
  }
}