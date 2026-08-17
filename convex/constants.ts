export const ACTION_TIMEOUT = 120_000;
// export const ACTION_TIMEOUT = 60_000;

export const IDLE_WORLD_TIMEOUT = 5 * 60 * 1000;
export const WORLD_HEARTBEAT_INTERVAL = 60 * 1000;

export const MAX_STEP = 10 * 60 * 1000;
export const TICK = 16;
export const STEP_INTERVAL = 1000;

export const PATHFINDING_TIMEOUT = 60 * 1000;
export const PATHFINDING_BACKOFF = 1000;
export const CONVERSATION_DISTANCE = 1.3;
export const MIDPOINT_THRESHOLD = 4;
export const TYPING_TIMEOUT = 15 * 1000;
export const COLLISION_THRESHOLD = 0.75;

// Сколько человеческих игроков может находиться в мире одновременно.
export const MAX_HUMAN_PLAYERS = 8;

// После разговора NPC одну минуту не начинает новый разговор.
export const CONVERSATION_COOLDOWN = 60_000;

// После активности NPC немного ждёт перед следующей активностью.
export const ACTIVITY_COOLDOWN = 10_000;

// Не разговаривать повторно с тем же персонажем одну минуту.
export const PLAYER_CONVERSATION_COOLDOWN = 60_000;

// Вероятность принятия приглашения от другого NPC.
export const INVITE_ACCEPT_PROBABILITY = 0.8;

// Максимальное ожидание принятия приглашения.
export const INVITE_TIMEOUT = 60_000;

// Сколько ждать реплику собеседника.
export const AWKWARD_CONVERSATION_TIMEOUT = 60_000;

// Максимальная продолжительность обычного разговора NPC.
export const MAX_CONVERSATION_DURATION = 2 * 60_000;

// Максимальное число сообщений в одном разговоре.
export const MAX_CONVERSATION_MESSAGES = 8;

// Небольшая пауза после отправки input в движок.
export const INPUT_DELAY = 1000;

// Количество воспоминаний для поиска.
export const NUM_MEMORIES_TO_SEARCH = 3;

// Минимальная пауза между сообщениями.
export const MESSAGE_COOLDOWN = 2000;

// Не запускать новый ход агента чаще раза в секунду.
export const AGENT_WAKEUP_THRESHOLD = 1000;

// Срок хранения старых воспоминаний.
export const VACUUM_MAX_AGE = 2 * 7 * 24 * 60 * 60 * 1000;
export const DELETE_BATCH_SIZE = 64;

// Человека больше не выбрасывает через 5 минут.
// Можно спокойно оставить город открытым и наблюдать.
export const HUMAN_IDLE_TOO_LONG = 60 * 60 * 1000;

export const ACTIVITIES = [
  {
    description: 'reading a book',
    emoji: '📖',
    duration: 60_000,
  },
  {
    description: 'daydreaming',
    emoji: '🤔',
    duration: 60_000,
  },
  {
    description: 'gardening',
    emoji: '🥕',
    duration: 60_000,
  },
];

export const ENGINE_ACTION_DURATION = 30_000;

// Максимальное количество поисков пути за один игровой шаг.
export const MAX_PATHFINDS_PER_STEP = 16;

export const DEFAULT_NAME = 'Me';
