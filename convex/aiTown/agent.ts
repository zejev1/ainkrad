import { ObjectType, v } from 'convex/values';
import { GameId, parseGameId } from './ids';
import { agentId, conversationId, playerId } from './ids';
import { serializedPlayer } from './player';
import { Game } from './game';

import {
  ACTION_TIMEOUT,
  AWKWARD_CONVERSATION_TIMEOUT,
  CONVERSATION_COOLDOWN,
  CONVERSATION_DISTANCE,
  INVITE_ACCEPT_PROBABILITY,
  INVITE_TIMEOUT,
  MAX_CONVERSATION_DURATION,
  MAX_CONVERSATION_MESSAGES,
  MESSAGE_COOLDOWN,
  MIDPOINT_THRESHOLD,
  PLAYER_CONVERSATION_COOLDOWN,
} from '../constants';

import { FunctionArgs } from 'convex/server';
import {
  MutationCtx,
  internalMutation,
  internalQuery,
} from '../_generated/server';

import { distance } from '../util/geometry';
import { internal } from '../_generated/api';
import { movePlayer } from './movement';
import { insertInput } from './insertInput';

// Не позволяем случайно снова протащить
// карту, весь мир или большой массив NPC
// через pendingOperations / Convex scheduler.
const MAX_AGENT_OPERATION_PAYLOAD_SIZE =
  8 * 1024;

export class Agent {
  id: GameId<'agents'>;
  playerId: GameId<'players'>;

  toRemember?: GameId<'conversations'>;

  lastConversation?: number;
  lastInviteAttempt?: number;

  inProgressOperation?: {
    name: string;
    operationId: string;
    started: number;
  };

  constructor(serialized: SerializedAgent) {
    const {
      id,
      lastConversation,
      lastInviteAttempt,
      inProgressOperation,
    } = serialized;

    const playerId = parseGameId(
      'players',
      serialized.playerId,
    );

    this.id = parseGameId(
      'agents',
      id,
    );

    this.playerId = playerId;

    this.toRemember =
      serialized.toRemember !== undefined
        ? parseGameId(
            'conversations',
            serialized.toRemember,
          )
        : undefined;

    this.lastConversation =
      lastConversation;

    this.lastInviteAttempt =
      lastInviteAttempt;

    this.inProgressOperation =
      inProgressOperation;
  }

  tick(
    game: Game,
    now: number,
  ) {
    const player =
      game.world.players.get(
        this.playerId,
      );

    if (!player) {
      throw new Error(
        `Invalid player ID ${this.playerId}`,
      );
    }

    // Если агент уже выполняет
    // внешнюю операцию —
    // ждём её завершения.
    if (this.inProgressOperation) {
      if (
        now <
        this.inProgressOperation.started +
          ACTION_TIMEOUT
      ) {
        return;
      }

      console.log(
        `Timing out ${JSON.stringify(
          this.inProgressOperation,
        )}`,
      );

      delete this.inProgressOperation;
    }

    const conversation =
      game.world.playerConversation(
        player,
      );

    const member =
      conversation?.participants.get(
        player.id,
      );

    const recentlyAttemptedInvite =
      this.lastInviteAttempt &&
      now <
        this.lastInviteAttempt +
          CONVERSATION_COOLDOWN;

    const doingActivity =
      player.activity &&
      player.activity.until > now;

    // Если персонаж занят активностью,
    // но оказался в разговоре
    // или начал движение —
    // прекращаем старую активность.
    if (
      doingActivity &&
      (
        conversation ||
        player.pathfinding
      )
    ) {
      player.activity!.until =
        now;
    }

    // --------------------------------------------------
    // NPC НЕ В РАЗГОВОРЕ
    // --------------------------------------------------

    if (
      !conversation &&
      !doingActivity &&
      (
        !player.pathfinding ||
        !recentlyAttemptedInvite
      )
    ) {
      // ВАЖНО:
      //
      // раньше сюда передавались:
      // - полный player
      // - полный agent
      // - все свободные игроки
      // - вся карта
      //
      // Всё это попадало в pendingOperations,
      // а затем могло раздувать scheduled functions.
      //
      // Теперь передаём ТОЛЬКО ID.
      //
      // Полный контекст будет загружен
      // позже внутри agentDoSomethingLight.

      this.startOperation(
        game,
        now,
        'agentDoSomethingLight',
        {
          worldId:
            game.worldId,

          playerId:
            player.id,

          agentId:
            this.id,
        },
      );

      return;
    }

    // --------------------------------------------------
    // ЗАПОМНИТЬ ЗАВЕРШЁННЫЙ РАЗГОВОР
    // --------------------------------------------------

    if (this.toRemember) {
      console.log(
        `Agent ${this.id} remembering conversation ${this.toRemember}`,
      );

      this.startOperation(
        game,
        now,
        'agentRememberConversation',
        {
          worldId:
            game.worldId,

          playerId:
            this.playerId,

          agentId:
            this.id,

          conversationId:
            this.toRemember,
        },
      );

      delete this.toRemember;

      return;
    }

    // --------------------------------------------------
    // NPC НАХОДИТСЯ В РАЗГОВОРЕ
    // --------------------------------------------------

    if (
      conversation &&
      member
    ) {
      const [
        otherPlayerId,
        otherMember,
      ] = [
        ...conversation.participants.entries(),
      ].find(
        ([id]) =>
          id !== player.id,
      )!;

      void otherMember;

      const otherPlayer =
        game.world.players.get(
          otherPlayerId,
        )!;

      // ------------------------------------------------
      // ПРИГЛАШЕНИЕ
      // ------------------------------------------------

      if (
        member.status.kind ===
        'invited'
      ) {
        // Приглашение человека
        // принимается всегда.
        //
        // Приглашение NPC —
        // с заданной вероятностью.
        if (
          otherPlayer.human ||
          Math.random() <
            INVITE_ACCEPT_PROBABILITY
        ) {
          console.log(
            `Agent ${player.id} accepting invite from ${otherPlayer.id}`,
          );

          conversation.acceptInvite(
            game,
            player,
          );

          // Останавливаем старое движение,
          // чтобы NPC пошёл
          // к собеседнику.
          if (
            player.pathfinding
          ) {
            delete player.pathfinding;
          }
        } else {
          console.log(
            `Agent ${player.id} rejecting invite from ${otherPlayer.id}`,
          );

          conversation.rejectInvite(
            game,
            now,
            player,
          );
        }

        return;
      }

      // ------------------------------------------------
      // NPC ИДУТ ДРУГ К ДРУГУ
      // ------------------------------------------------

      if (
        member.status.kind ===
        'walkingOver'
      ) {
        // Если слишком долго
        // не получается встретиться —
        // отменяем разговор.
        if (
          member.invited +
            INVITE_TIMEOUT <
          now
        ) {
          console.log(
            `Giving up on invite to ${otherPlayer.id}`,
          );

          conversation.leave(
            game,
            now,
            player,
          );

          return;
        }

        const playerDistance =
          distance(
            player.position,
            otherPlayer.position,
          );

        // Уже достаточно близко.
        if (
          playerDistance <
          CONVERSATION_DISTANCE
        ) {
          return;
        }

        // Если ещё не движемся —
        // начинаем идти
        // к собеседнику.
        if (
          !player.pathfinding
        ) {
          let destination;

          if (
            playerDistance <
            MIDPOINT_THRESHOLD
          ) {
            destination = {
              x: Math.floor(
                otherPlayer
                  .position.x,
              ),

              y: Math.floor(
                otherPlayer
                  .position.y,
              ),
            };
          } else {
            destination = {
              x: Math.floor(
                (
                  player.position.x +
                  otherPlayer.position.x
                ) /
                  2,
              ),

              y: Math.floor(
                (
                  player.position.y +
                  otherPlayer.position.y
                ) /
                  2,
              ),
            };
          }

          console.log(
            `Agent ${player.id} walking towards ${otherPlayer.id}...`,
            destination,
          );

          movePlayer(
            game,
            now,
            player,
            destination,
          );
        }

        return;
      }

      // ------------------------------------------------
      // АКТИВНЫЙ РАЗГОВОР
      // ------------------------------------------------

      if (
        member.status.kind ===
        'participating'
      ) {
        const started =
          member.status.started;

        // ===============================================
        // ВАЖНЫЙ FIX:
        //
        // после достижения лимита
        // разговор завершается сразу.
        //
        // Мы не ждём дополнительную
        // AI-реплику.
        // ===============================================

        const tooLongDeadline =
          started +
          MAX_CONVERSATION_DURATION;

        if (
          tooLongDeadline <
            now ||
          conversation
            .numMessages >=
            MAX_CONVERSATION_MESSAGES
        ) {
          console.log(
            `Agent ${player.id} force-ending conversation with ${otherPlayer.id}.`,
          );

          conversation.leave(
            game,
            now,
            player,
          );

          return;
        }

        // Если другой персонаж
        // сейчас печатает —
        // ждём его.
        if (
          conversation.isTyping &&
          conversation
            .isTyping
            .playerId !==
            player.id
        ) {
          return;
        }

        // ------------------------------------------------
        // ПЕРВОЕ СООБЩЕНИЕ
        // ------------------------------------------------

        if (
          !conversation.lastMessage
        ) {
          const isInitiator =
            conversation.creator ===
            player.id;

          const awkwardDeadline =
            started +
            AWKWARD_CONVERSATION_TIMEOUT;

          if (
            isInitiator ||
            awkwardDeadline <
              now
          ) {
            console.log(
              `${player.id} initiating conversation with ${otherPlayer.id}.`,
            );

            const messageUuid =
              crypto.randomUUID();

            conversation.setIsTyping(
              now,
              player,
              messageUuid,
            );

            this.startOperation(
              game,
              now,
              'agentGenerateMessage',
              {
                worldId:
                  game.worldId,

                playerId:
                  player.id,

                agentId:
                  this.id,

                conversationId:
                  conversation.id,

                otherPlayerId:
                  otherPlayer.id,

                messageUuid,

                type:
                  'start',
              },
            );

            return;
          }

          return;
        }

        // ------------------------------------------------
        // ЕСЛИ ПОСЛЕДНЕЕ СООБЩЕНИЕ
        // НАПИСАЛ ЭТОТ NPC
        // ------------------------------------------------

        if (
          conversation
            .lastMessage
            .author ===
          player.id
        ) {
          const awkwardDeadline =
            conversation
              .lastMessage
              .timestamp +
            AWKWARD_CONVERSATION_TIMEOUT;

          if (
            now <
            awkwardDeadline
          ) {
            return;
          }
        }

        // ------------------------------------------------
        // ПАУЗА ПЕРЕД ОТВЕТОМ
        // ------------------------------------------------

        const messageCooldown =
          conversation
            .lastMessage
            .timestamp +
          MESSAGE_COOLDOWN;

        if (
          now <
          messageCooldown
        ) {
          return;
        }

        // ------------------------------------------------
        // ПРОДОЛЖИТЬ РАЗГОВОР
        // ------------------------------------------------

        console.log(
          `${player.id} continuing conversation with ${otherPlayer.id}.`,
        );

        const messageUuid =
          crypto.randomUUID();

        conversation.setIsTyping(
          now,
          player,
          messageUuid,
        );

        this.startOperation(
          game,
          now,
          'agentGenerateMessage',
          {
            worldId:
              game.worldId,

            playerId:
              player.id,

            agentId:
              this.id,

            conversationId:
              conversation.id,

            otherPlayerId:
              otherPlayer.id,

            messageUuid,

            type:
              'continue',
          },
        );

        return;
      }
    }
  }

  startOperation<
    Name extends keyof AgentOperations,
  >(
    game: Game,
    now: number,
    name: Name,
    args: Omit<
      FunctionArgs<
        AgentOperations[Name]
      >,
      'operationId'
    >,
  ) {
    if (
      this.inProgressOperation
    ) {
      throw new Error(
        `Agent ${this.id} already has an operation: ${JSON.stringify(
          this.inProgressOperation,
        )}`,
      );
    }

    const operationId =
      game.allocId(
        'operations',
      );

    const operationArgs = {
      operationId,
      ...args,
    };

    // --------------------------------------------------
    // ЗАЩИТА ОТ БОЛЬШИХ PAYLOAD
    // --------------------------------------------------
    //
    // Если кто-нибудь в будущем снова
    // попробует передать сюда карту,
    // весь мир или большой массив NPC,
    // операция будет остановлена сразу.
    //
    // Лучше получить явную ошибку,
    // чем снова раздуть _scheduled_functions.
    // --------------------------------------------------

    const serializedOperation =
      JSON.stringify(
        operationArgs,
      );

    if (
      serializedOperation.length >
      MAX_AGENT_OPERATION_PAYLOAD_SIZE
    ) {
      throw new Error(
        `Agent operation ${String(
          name,
        )} payload is too large: ${serializedOperation.length} > ${MAX_AGENT_OPERATION_PAYLOAD_SIZE}`,
      );
    }

    console.log(
      `Agent ${this.id} starting operation ${String(
        name,
      )} (${operationId})`,
    );

    game.scheduleOperation(
      String(name),
      operationArgs,
    );

    this.inProgressOperation = {
      name:
        String(name),

      operationId,

      started:
        now,
    };
  }

  serialize():
    SerializedAgent {
    return {
      id:
        this.id,

      playerId:
        this.playerId,

      toRemember:
        this.toRemember,

      lastConversation:
        this.lastConversation,

      lastInviteAttempt:
        this.lastInviteAttempt,

      inProgressOperation:
        this.inProgressOperation,
    };
  }
}

export const serializedAgent = {
  id:
    agentId,

  playerId:
    playerId,

  toRemember:
    v.optional(
      conversationId,
    ),

  lastConversation:
    v.optional(
      v.number(),
    ),

  lastInviteAttempt:
    v.optional(
      v.number(),
    ),

  inProgressOperation:
    v.optional(
      v.object({
        name:
          v.string(),

        operationId:
          v.string(),

        started:
          v.number(),
      }),
    ),
};

export type SerializedAgent =
  ObjectType<
    typeof serializedAgent
  >;

type AgentOperations =
  typeof internal.aiTown
    .agentOperations;

// ======================================================
// ЗАПУСК АГЕНТСКИХ ОПЕРАЦИЙ
// ======================================================
//
// Здесь намеренно НЕТ универсального:
//
// scheduler.runAfter(..., args)
//
// Каждый тип операции имеет
// отдельный явно заданный маленький payload.
//
// Это защищает нас от случайной
// отправки огромного объекта в scheduler.
// ======================================================

export async function runAgentOperation(
  ctx: MutationCtx,
  operation: string,
  args: any,
) {
  switch (operation) {
    // --------------------------------------------------
    // ЗАПОМНИТЬ РАЗГОВОР
    // --------------------------------------------------

    case 'agentRememberConversation':
      await ctx.scheduler.runAfter(
        0,
        internal.aiTown
          .agentOperations
          .agentRememberConversation,
        {
          worldId:
            args.worldId,

          playerId:
            args.playerId,

          agentId:
            args.agentId,

          conversationId:
            args.conversationId,

          operationId:
            args.operationId,
        },
      );

      return;

    // --------------------------------------------------
    // СГЕНЕРИРОВАТЬ СООБЩЕНИЕ
    // --------------------------------------------------

    case 'agentGenerateMessage':
      await ctx.scheduler.runAfter(
        0,
        internal.aiTown
          .agentOperations
          .agentGenerateMessage,
        {
          worldId:
            args.worldId,

          playerId:
            args.playerId,

          agentId:
            args.agentId,

          conversationId:
            args.conversationId,

          otherPlayerId:
            args.otherPlayerId,

          operationId:
            args.operationId,

          type:
            args.type,

          messageUuid:
            args.messageUuid,
        },
      );

      return;

    // --------------------------------------------------
    // ОБЫЧНЫЙ ХОД NPC
    // --------------------------------------------------
    //
    // В scheduler уходят только ID.
    //
    // Игрок, агент, карта и остальные NPC
    // будут загружены уже внутри
    // agentDoSomethingLight.
    // --------------------------------------------------

    case 'agentDoSomethingLight':
      await ctx.scheduler.runAfter(
        0,
        internal.aiTown
          .agentOperations
          .agentDoSomethingLight,
        {
          worldId:
            args.worldId,

          playerId:
            args.playerId,

          agentId:
            args.agentId,

          operationId:
            args.operationId,
        },
      );

      return;

    default:
      throw new Error(
        `Unknown operation: ${operation}`,
      );
  }
}

export const agentSendMessage =
  internalMutation({
    args: {
      worldId:
        v.id(
          'worlds',
        ),

      conversationId,

      agentId,

      playerId,

      text:
        v.string(),

      messageUuid:
        v.string(),

      leaveConversation:
        v.boolean(),

      operationId:
        v.string(),
    },

    handler: async (
      ctx,
      args,
    ) => {
      await ctx.db.insert(
        'messages',
        {
          conversationId:
            args.conversationId,

          author:
            args.playerId,

          text:
            args.text,

          messageUuid:
            args.messageUuid,

          worldId:
            args.worldId,
        },
      );

      await insertInput(
        ctx,
        args.worldId,
        'agentFinishSendingMessage',
        {
          conversationId:
            args.conversationId,

          agentId:
            args.agentId,

          timestamp:
            Date.now(),

          leaveConversation:
            args.leaveConversation,

          operationId:
            args.operationId,
        },
      );
    },
  });

export const findConversationCandidate =
  internalQuery({
    args: {
      now:
        v.number(),

      worldId:
        v.id(
          'worlds',
        ),

      player:
        v.object(
          serializedPlayer,
        ),

      otherFreePlayers:
        v.array(
          v.object(
            serializedPlayer,
          ),
        ),
    },

    handler: async (
      ctx,
      {
        now,
        worldId,
        player,
        otherFreePlayers,
      },
    ) => {
      const {
        position,
      } = player;

      const candidates: {
        id:
          GameId<'players'>;

        score:
          number;
      }[] = [];

      // Загружаем историю отношений
      // текущего NPC ко всем остальным.
      const relationshipMemories =
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
                  player.id,
                )
                .eq(
                  'data.type',
                  'relationship',
                ),
          )
          .order(
            'desc',
          )
          .collect();

      for (
        const otherPlayer of
          otherFreePlayers
      ) {
        // Не позволяем NPC
        // моментально снова идти
        // к тому же человеку.
        const lastMember =
          await ctx.db
            .query(
              'participatedTogether',
            )
            .withIndex(
              'edge',
              (q) =>
                q
                  .eq(
                    'worldId',
                    worldId,
                  )
                  .eq(
                    'player1',
                    player.id,
                  )
                  .eq(
                    'player2',
                    otherPlayer.id,
                  ),
            )
            .order(
              'desc',
            )
            .first();

        if (
          lastMember &&
          now <
            lastMember.ended +
              PLAYER_CONVERSATION_COOLDOWN
        ) {
          continue;
        }

        // Берём самое свежее
        // отношение именно
        // к этому персонажу.
        const relationship =
          relationshipMemories.find(
            (memory) =>
              memory.data.type ===
                'relationship' &&
              memory.data.playerId ===
                otherPlayer.id,
          );

        let trust =
          0;

        let affinity =
          0;

        let respect =
          0;

        let conflict =
          0;

        if (
          relationship &&
          relationship.data.type ===
            'relationship'
        ) {
          trust =
            relationship
              .data
              .trust;

          affinity =
            relationship
              .data
              .affinity;

          respect =
            relationship
              .data
              .respect;

          conflict =
            relationship
              .data
              .conflict;
        }

        // -------------------------------------------------
        // СИЛЬНАЯ НЕПРИЯЗНЬ / КОНФЛИКТ
        // -------------------------------------------------

        if (
          conflict >=
            75 &&
          affinity <=
            -50 &&
          Math.random() <
            0.75
        ) {
          continue;
        }

        if (
          conflict >=
            50 &&
          affinity <=
            -25 &&
          Math.random() <
            0.4
        ) {
          continue;
        }

        const physicalDistance =
          distance(
            otherPlayer.position,
            position,
          );

        // -------------------------------------------------
        // СОЦИАЛЬНОЕ ПРИТЯЖЕНИЕ
        // -------------------------------------------------

        const socialPull =
          affinity *
            0.18 +
          trust *
            0.1 +
          respect *
            0.05 -
          conflict *
            0.22;

        // Немного случайности,
        // чтобы NPC не выбирал
        // одного и того же человека
        // математически каждый раз.
        const randomness =
          Math.random() *
          10;

        // Чем МЕНЬШЕ score,
        // тем привлекательнее кандидат.
        const score =
          physicalDistance -
          socialPull +
          randomness;

        candidates.push({
          id:
            otherPlayer.id as GameId<'players'>,

          score,
        });
      }

      candidates.sort(
        (
          a,
          b,
        ) =>
          a.score -
          b.score,
      );

      return candidates[0]?.id;
    },
  });
