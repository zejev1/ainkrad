import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { internalMutation } from './_generated/server';

import { DELETE_BATCH_SIZE } from './constants';

import {
  RETENTION,
  isAutoDeleteTable,
} from './retentionPolicy';

// ======================================================
// AINKRAD RETENTION ENGINE
// ======================================================
//
// Этот файл ФИЗИЧЕСКИ выполняет очистку.
//
// Правила находятся только в:
//
// retentionPolicy.ts
//
// Главная защита:
//
// таблица, которой нет в AUTO_DELETE_TABLES,
// не может быть удалена этим механизмом.
// ======================================================

const MAX_INPUT_DELETE_PER_RUN =
  500;

const AGE_TABLES = [
  'messages',
  'archivedConversations',
  'participatedTogether',
  'embeddingsCache',
] as const;

type AgeCleanupTable =
  typeof AGE_TABLES[number];

const AGE_TABLE_SET =
  new Set<string>(
    AGE_TABLES,
  );

// ======================================================
// ЗАЩИТА
// ======================================================

function assertCanAutoDelete(
  tableName: string,
) {
  if (
    !isAutoDeleteTable(
      tableName,
    )
  ) {
    throw new Error(
      `Retention refused to delete protected table: ${tableName}`,
    );
  }
}

function isAgeCleanupTable(
  tableName: string,
): tableName is AgeCleanupTable {
  return AGE_TABLE_SET.has(
    tableName,
  );
}

function ageLimitFor(
  tableName: AgeCleanupTable,
) {
  switch (tableName) {
    case 'messages':
      return RETENTION
        .messages
        .maxAgeMs;

    case 'archivedConversations':
      return RETENTION
        .archivedConversations
        .maxAgeMs;

    case 'participatedTogether':
      return RETENTION
        .participatedTogether
        .maxAgeMs;

    case 'embeddingsCache':
      return RETENTION
        .embeddingsCache
        .maxAgeMs;
  }
}

// ======================================================
// ГЛАВНЫЙ ЕЖЕДНЕВНЫЙ ЗАПУСК
// ======================================================

export const runDailyRetention =
  internalMutation({
    args: {},

    handler: async (ctx) => {
      const now =
        Date.now();

      // -----------------------------------------------
      // Таблицы с обычным сроком хранения
      // -----------------------------------------------

      for (
        const tableName of
        AGE_TABLES
      ) {
        assertCanAutoDelete(
          tableName,
        );

        const before =
          now -
          ageLimitFor(
            tableName,
          );

        await ctx.scheduler.runAfter(
          0,
          internal.retention
            .cleanupAgePage,
          {
            tableName,
            before,
            cursor: null,
            soFar: 0,
          },
        );
      }

      // -----------------------------------------------
      // Memories требуют специальной логики.
      // -----------------------------------------------

      assertCanAutoDelete(
        'memories',
      );

      assertCanAutoDelete(
        'memoryEmbeddings',
      );

      await ctx.scheduler.runAfter(
        0,
        internal.retention
          .cleanupMemoriesPage,
        {
          conversationBefore:
            now -
            RETENTION
              .memories
              .conversationMaxAgeMs,

          reflectionBefore:
            now -
            RETENTION
              .memories
              .reflectionMaxAgeMs,

          relationshipBefore:
            now -
            RETENTION
              .memories
              .relationshipHistoryMaxAgeMs,

          cursor: null,
          soFar: 0,
        },
      );

      return {
        started: true,
        at: now,
      };
    },
  });

// ======================================================
// ОБЫЧНАЯ ОЧИСТКА ПО ВОЗРАСТУ
// ======================================================

export const cleanupAgePage =
  internalMutation({
    args: {
      tableName:
        v.string(),

      before:
        v.number(),

      cursor:
        v.union(
          v.string(),
          v.null(),
        ),

      soFar:
        v.number(),
    },

    handler: async (
      ctx,
      {
        tableName,
        before,
        cursor,
        soFar,
      },
    ) => {
      // -----------------------------------------------
      // ДВОЙНАЯ ЗАЩИТА
      // -----------------------------------------------

      assertCanAutoDelete(
        tableName,
      );

      if (
        !isAgeCleanupTable(
          tableName,
        )
      ) {
        throw new Error(
          `Table ${tableName} is not allowed to use age cleanup`,
        );
      }

      const results =
        await ctx.db
          .query(
            tableName as TableNames,
          )
          .withIndex(
            'by_creation_time',
            (q) =>
              q.lt(
                '_creationTime',
                before,
              ),
          )
          .paginate({
            cursor,
            numItems:
              DELETE_BATCH_SIZE,
          });

      for (
        const row of
        results.page
      ) {
        await ctx.db.delete(
          row._id,
        );
      }

      const total =
        soFar +
        results.page.length;

      if (
        !results.isDone
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.retention
            .cleanupAgePage,
          {
            tableName,
            before,

            cursor:
              results
                .continueCursor,

            soFar:
              total,
          },
        );
      } else {
        console.log(
          `Retention deleted ${total} rows from ${tableName}`,
        );
      }

      return {
        tableName,
        deleted:
          results.page.length,
        total,
        done:
          results.isDone,
      };
    },
  });

// ======================================================
// INPUTS
// ======================================================
//
// Здесь НЕ используется возраст.
//
// Движок говорит нам,
// какой input уже обработан.
//
// Мы оставляем последние N,
// заданные retentionPolicy.
// ======================================================

export const cleanupProcessedInputs =
  internalMutation({
    args: {},

    handler: async (ctx) => {
      assertCanAutoDelete(
        'inputs',
      );

      const engines =
        await ctx.db
          .query(
            'engines',
          )
          .collect();

      let deleted =
        0;

      const details:
        Array<{
          engineId:
            string;

          cutoff:
            number;

          deleted:
            number;
        }> = [];

      for (
        const engine of
        engines
      ) {
        if (
          deleted >=
          MAX_INPUT_DELETE_PER_RUN
        ) {
          break;
        }

        const processed =
          engine
            .processedInputNumber ??
          -1;

        const cutoff =
          processed -
          RETENTION
            .inputs
            .keepRecent;

        if (
          cutoff < 0
        ) {
          continue;
        }

        const remaining =
          MAX_INPUT_DELETE_PER_RUN -
          deleted;

        const oldInputs =
          await ctx.db
            .query(
              'inputs',
            )
            .withIndex(
              'byInputNumber',
              (q) =>
                q
                  .eq(
                    'engineId',
                    engine._id,
                  )
                  .lte(
                    'number',
                    cutoff,
                  ),
            )
            .order(
              'asc',
            )
            .take(
              remaining,
            );

        for (
          const input of
          oldInputs
        ) {
          await ctx.db.delete(
            input._id,
          );
        }

        deleted +=
          oldInputs.length;

        details.push({
          engineId:
            String(
              engine._id,
            ),

          cutoff,

          deleted:
            oldInputs.length,
        });
      }

      console.log(
        `Retention deleted ${deleted} processed inputs`,
      );

      return {
        deleted,

        keepRecent:
          RETENTION
            .inputs
            .keepRecent,

        details,
      };
    },
  });

// ======================================================
// CARDINAL EVENTS
// ======================================================
//
// Здесь НЕ удаляем события
// просто потому что они старые.
//
// Удаляется только событие,
// которое само объявило:
//
// expiresAt <= now
//
// Событие без expiresAt
// считается постоянным.
// ======================================================

export const cleanupExpiredCardinalEvents =
  internalMutation({
    args: {},

    handler: async (ctx) => {
      assertCanAutoDelete(
        'cardinalEvents',
      );

      await ctx.scheduler.runAfter(
        0,
        internal.retention
          .cleanupExpiredCardinalEventsPage,
        {
          expiresBefore:
            Date.now(),

          cursor: null,
          soFar: 0,
        },
      );
    },
  });

export const cleanupExpiredCardinalEventsPage =
  internalMutation({
    args: {
      expiresBefore:
        v.number(),

      cursor:
        v.union(
          v.string(),
          v.null(),
        ),

      soFar:
        v.number(),
    },

    handler: async (
      ctx,
      {
        expiresBefore,
        cursor,
        soFar,
      },
    ) => {
      assertCanAutoDelete(
        'cardinalEvents',
      );

      const results =
        await ctx.db
          .query(
            'cardinalEvents',
          )
          .paginate({
            cursor,
            numItems:
              DELETE_BATCH_SIZE,
          });

      let deletedThisPage =
        0;

      for (
        const event of
        results.page
      ) {
        // Нет expiresAt =
        // постоянное событие.
        if (
          event.expiresAt ===
          undefined
        ) {
          continue;
        }

        if (
          event.expiresAt >
          expiresBefore
        ) {
          continue;
        }

        await ctx.db.delete(
          event._id,
        );

        deletedThisPage++;
      }

      const total =
        soFar +
        deletedThisPage;

      if (
        !results.isDone
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.retention
            .cleanupExpiredCardinalEventsPage,
          {
            expiresBefore,

            cursor:
              results
                .continueCursor,

            soFar:
              total,
          },
        );
      } else {
        console.log(
          `Retention removed ${total} expired Cardinal events`,
        );
      }

      return {
        deleted:
          deletedThisPage,

        total,

        done:
          results.isDone,
      };
    },
  });

// ======================================================
// MEMORIES
// ======================================================
//
// conversation:
// удаляем после срока хранения,
// если память давно не использовалась.
//
// reflection:
// то же самое.
//
// relationship:
// удаляем только СТАРУЮ историю.
//
// САМОЕ НОВОЕ состояние отношений
// каждой пары NPC сохраняется.
// ======================================================

export const cleanupMemoriesPage =
  internalMutation({
    args: {
      conversationBefore:
        v.number(),

      reflectionBefore:
        v.number(),

      relationshipBefore:
        v.number(),

      cursor:
        v.union(
          v.string(),
          v.null(),
        ),

      soFar:
        v.number(),
    },

    handler: async (
      ctx,
      {
        conversationBefore,
        reflectionBefore,
        relationshipBefore,
        cursor,
        soFar,
      },
    ) => {
      assertCanAutoDelete(
        'memories',
      );

      assertCanAutoDelete(
        'memoryEmbeddings',
      );

      // Самый ранний cutoff нужен
      // только чтобы не читать
      // совсем свежие memories.
      const oldestCandidateBefore =
        Math.max(
          conversationBefore,
          reflectionBefore,
        );

      const results =
        await ctx.db
          .query(
            'memories',
          )
          .withIndex(
            'by_creation_time',
            (q) =>
              q.lt(
                '_creationTime',
                oldestCandidateBefore,
              ),
          )
          .paginate({
            cursor,
            numItems:
              DELETE_BATCH_SIZE,
          });

      let deletedThisPage =
        0;

      for (
        const memory of
        results.page
      ) {
        let shouldDelete =
          false;

        // ---------------------------------------------
        // CONVERSATION
        // ---------------------------------------------

        if (
          memory.data.type ===
          'conversation'
        ) {
          shouldDelete =
            memory._creationTime <
              conversationBefore &&
            memory.lastAccess <
              conversationBefore;
        }

        // ---------------------------------------------
        // REFLECTION
        // ---------------------------------------------

        if (
          memory.data.type ===
          'reflection'
        ) {
          shouldDelete =
            memory._creationTime <
              reflectionBefore &&
            memory.lastAccess <
              reflectionBefore;
        }

        // ---------------------------------------------
        // RELATIONSHIP
        // ---------------------------------------------

        if (
          memory.data.type ===
          'relationship' &&
          memory._creationTime <
            relationshipBefore &&
          memory.data.updatedAt <
            relationshipBefore
        ) {
          if (
            RETENTION
              .memories
              .keepLatestRelationship
          ) {
            const latest =
              await ctx.db
                .query(
                  'memories',
                )
                .withIndex(
                  'playerId_type',
                  (q) =>
                    q
                      .eq(
                        'playerId',
                        memory.playerId,
                      )
                      .eq(
                        'data.type',
                        'relationship',
                      ),
                )
                .order(
                  'desc',
                )
                .filter(
                  (q) =>
                    q.eq(
                      q.field(
                        'data.playerId',
                      ),
                      memory.data.playerId,
                    ),
                )
                .first();

            // Если это НЕ самая новая
            // запись отношений —
            // старую историю можно удалить.
            shouldDelete =
              latest !== null &&
              latest._id !==
                memory._id;
          } else {
            shouldDelete =
              true;
          }
        }

        if (
          !shouldDelete
        ) {
          continue;
        }

        await deleteMemorySafely(
          ctx,
          memory,
        );

        deletedThisPage++;
      }

      const total =
        soFar +
        deletedThisPage;

      if (
        !results.isDone
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.retention
            .cleanupMemoriesPage,
          {
            conversationBefore,
            reflectionBefore,
            relationshipBefore,

            cursor:
              results
                .continueCursor,

            soFar:
              total,
          },
        );
      } else {
        console.log(
          `Retention removed ${total} old memories`,
        );

        // После очистки memories
        // проверяем старые orphan embeddings.
        await ctx.scheduler.runAfter(
          0,
          internal.retention
            .cleanupOrphanEmbeddingsPage,
          {
            cursor: null,
            soFar: 0,
          },
        );
      }

      return {
        deleted:
          deletedThisPage,

        total,

        done:
          results.isDone,
      };
    },
  });

// ======================================================
// БЕЗОПАСНОЕ УДАЛЕНИЕ MEMORY
// ======================================================
//
// Сначала удаляем memory.
//
// Затем проверяем,
// осталась ли хоть одна memory,
// использующая тот же embedding.
//
// Только если embedding стал orphan,
// удаляем и его.
// ======================================================

async function deleteMemorySafely(
  ctx: any,
  memory: any,
) {
  const embeddingId =
    memory.embeddingId;

  await ctx.db.delete(
    memory._id,
  );

  const stillReferenced =
    await ctx.db
      .query(
        'memories',
      )
      .withIndex(
        'embeddingId',
        (q: any) =>
          q.eq(
            'embeddingId',
            embeddingId,
          ),
      )
      .first();

  if (
    stillReferenced
  ) {
    return;
  }

  const embedding =
    await ctx.db.get(
      embeddingId,
    );

  if (
    embedding
  ) {
    await ctx.db.delete(
      embeddingId,
    );
  }
}

// ======================================================
// ORPHAN MEMORY EMBEDDINGS
// ======================================================
//
// Эта функция исправляет также старые orphan embeddings,
// которые могли остаться от прежнего vacuum.
//
// На существующую memory она никогда
// не поднимет руку.
// ======================================================

export const cleanupOrphanEmbeddingsPage =
  internalMutation({
    args: {
      cursor:
        v.union(
          v.string(),
          v.null(),
        ),

      soFar:
        v.number(),
    },

    handler: async (
      ctx,
      {
        cursor,
        soFar,
      },
    ) => {
      assertCanAutoDelete(
        'memoryEmbeddings',
      );

      const results =
        await ctx.db
          .query(
            'memoryEmbeddings',
          )
          .paginate({
            cursor,
            numItems:
              DELETE_BATCH_SIZE,
          });

      let deletedThisPage =
        0;

      for (
        const embedding of
        results.page
      ) {
        const memory =
          await ctx.db
            .query(
              'memories',
            )
            .withIndex(
              'embeddingId',
              (q) =>
                q.eq(
                  'embeddingId',
                  embedding._id,
                ),
            )
            .first();

        // Есть memory =
        // embedding защищён.
        if (
          memory
        ) {
          continue;
        }

        await ctx.db.delete(
          embedding._id,
        );

        deletedThisPage++;
      }

      const total =
        soFar +
        deletedThisPage;

      if (
        !results.isDone
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.retention
            .cleanupOrphanEmbeddingsPage,
          {
            cursor:
              results
                .continueCursor,

            soFar:
              total,
          },
        );
      } else {
        console.log(
          `Retention removed ${total} orphan memory embeddings`,
        );
      }

      return {
        deleted:
          deletedThisPage,

        total,

        done:
          results.isDone,
      };
    },
  });
