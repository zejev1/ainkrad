import { v } from 'convex/values';
import { internal } from './_generated/api';

import type {
  TableNames,
} from './_generated/dataModel';

import {
  internalMutation,
} from './_generated/server';

import {
  DELETE_BATCH_SIZE,
} from './constants';

import {
  RETENTION,
  isAutoDeleteTable,
} from './retentionPolicy';

// ======================================================
// AINKRAD RETENTION ENGINE
// ======================================================
//
// Правила хранения:
//
// retentionPolicy.ts
//
// Этот файл только выполняет
// разрешённые правила.
//
// Всё, чего нет в AUTO_DELETE_TABLES,
// считается защищённым.
// ======================================================

// Пока generated API ещё не обновился,
// обращаемся к новому модулю через any.
//
// После следующего успешного Convex codegen
// это можно будет заменить
// на обычный internal.retention.
const retentionInternal =
  (internal as any)
    .retention;

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
      // Простые таблицы,
      // которые очищаются по возрасту.
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
          retentionInternal
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
      // Memories имеют специальные правила.
      // -----------------------------------------------

      assertCanAutoDelete(
        'memories',
      );

      assertCanAutoDelete(
        'memoryEmbeddings',
      );

      await ctx.scheduler.runAfter(
        0,
        retentionInternal
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
// ОЧИСТКА ПО ВОЗРАСТУ
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
          retentionInternal
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
// Не удаляем inputs просто по возрасту.
//
// Смотрим processedInputNumber
// каждого движка и сохраняем
// последние N обработанных команд.
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

          processedInputNumber:
            number;

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

        const processedInputNumber =
          engine
            .processedInputNumber ??
          -1;

        const cutoff =
          processedInputNumber -
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

          processedInputNumber,

          cutoff,

          deleted:
            oldInputs.length,
        });
      }

      console.log(
        `Retention deleted ${deleted} processed inputs`,
      );

      // Если мы упёрлись в лимит,
      // значит хвост может быть ещё большим.
      //
      // Не ждём следующие 30 минут —
      // продолжаем маленькими порциями.
      if (
        deleted ===
        MAX_INPUT_DELETE_PER_RUN
      ) {
        await ctx.scheduler.runAfter(
          1000,
          retentionInternal
            .cleanupProcessedInputs,
          {},
        );
      }

      return {
        deleted,

        keepRecent:
          RETENTION
            .inputs
            .keepRecent,

        continuing:
          deleted ===
          MAX_INPUT_DELETE_PER_RUN,

        details,
      };
    },
  });

// ======================================================
// CARDINAL EVENTS
// ======================================================
//
// Событие удаляется только если:
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
        retentionInternal
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
        // Нет expiresAt —
        // считаем событие постоянным.
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
          retentionInternal
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
// старая и давно не использовалась
// -> удалить.
//
// reflection:
// старая и давно не использовалась
// -> удалить.
//
// relationship:
// старые версии можно удалить,
// но последнюю запись каждой пары
// сохраняем.
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

      // conversation/reflection имеют
      // наиболее короткий срок.
      //
      // Relationship старше 90 дней
      // всё равно попадают в этот диапазон.
      const candidateBefore =
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
                candidateBefore,
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
        // CONVERSATION MEMORY
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
        // REFLECTION MEMORY
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
        // RELATIONSHIP MEMORY
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
                      memory
                        .data
                        .playerId,
                    ),
                )
                .first();

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
          retentionInternal
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

        // После основной очистки
        // удаляем старые orphan embeddings.
        await ctx.scheduler.runAfter(
          0,
          retentionInternal
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

async function deleteMemorySafely(
  ctx: any,
  memory: any,
) {
  const embeddingId =
    memory.embeddingId;

  // Сначала удаляется сама memory.
  await ctx.db.delete(
    memory._id,
  );

  // Проверяем, не использует ли
  // тот же embedding другая memory.
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
// Старые версии Ainkrad могли оставить
// embedding без соответствующей memory.
//
// Удаляем только такие записи.
//
// Если memory существует,
// embedding автоматически защищён.
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

        // Embedding всё ещё нужен.
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
          retentionInternal
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
