import { cronJobs } from 'convex/server';

import {
  IDLE_WORLD_TIMEOUT,
} from './constants';

import { internal } from './_generated/api';

const crons = cronJobs();

// ======================================================
// WORLD ENGINE
// ======================================================

crons.interval(
  'stop inactive worlds',
  {
    seconds:
      IDLE_WORLD_TIMEOUT /
      1000,
  },
  internal.world
    .stopInactiveWorlds,
);

crons.interval(
  'restart dead worlds',
  {
    seconds: 60,
  },
  internal.world
    .restartDeadWorlds,
);

// ======================================================
// AINKRAD RETENTION
// ======================================================
//
// Быстрая уборка небольших временных данных
// идёт регулярно.
//
// Более тяжёлая очистка истории
// выполняется один раз в сутки.
// ======================================================

// ------------------------------------------------------
// INPUTS
// ------------------------------------------------------
//
// Оставляет последние 500
// обработанных inputs каждого engine.
//
// Запускаем каждые 30 минут,
// чтобы таблица не успевала разрастаться.
// ------------------------------------------------------

crons.interval(
  'retention processed inputs',
  {
    minutes: 30,
  },
  (internal as any)
    .retention
    .cleanupProcessedInputs,
);

// ------------------------------------------------------
// CARDINAL EVENTS
// ------------------------------------------------------
//
// Удаляет только события,
// у которых expiresAt уже прошёл.
//
// Постоянные события без expiresAt
// остаются защищёнными.
// ------------------------------------------------------

crons.interval(
  'retention expired cardinal events',
  {
    minutes: 30,
  },
  (internal as any)
    .retention
    .cleanupExpiredCardinalEvents,
);

// ------------------------------------------------------
// ПОЛНАЯ ЕЖЕДНЕВНАЯ УБОРКА
// ------------------------------------------------------
//
// Чистит:
//
// messages
// archivedConversations
// participatedTogether
// embeddingsCache
// memories
// orphan memoryEmbeddings
//
// Но только по правилам
// retentionPolicy.ts.
// ------------------------------------------------------

crons.daily(
  'ainkrad data retention',
  {
    hourUTC: 4,
    minuteUTC: 20,
  },
  (internal as any)
    .retention
    .runDailyRetention,
);

// ======================================================
// CARDINAL
// ======================================================

crons.interval(
  'cardinal director pulse',
  {
    minutes: 5,
  },
  (internal as any)
    .cardinal
    .runtime
    .evaluateRunningWorlds,
);

export default crons;
