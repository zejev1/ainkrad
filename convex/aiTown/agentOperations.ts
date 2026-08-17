import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import {
  ACTIVITIES,
  ACTIVITY_COOLDOWN,
  CONVERSATION_COOLDOWN,
} from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },

  handler: async (ctx, args) => {
    await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );

    // Передаём завершившийся разговор Cardinal.
    try {
      const participants = await ctx.runQuery(
        (internal as any).cardinal.runtime.getConversationParticipants,
        {
          worldId: args.worldId,
          conversationId: args.conversationId,
          playerId: args.playerId,
        },
      );

      if (participants?.otherPlayerId) {
        await ctx.runMutation(
          (internal as any).cardinal.social.recordConversation,
          {
            worldId: args.worldId,
            conversationId: args.conversationId,
            playerId: args.playerId,
            otherPlayerId: participants.otherPlayerId,
          },
        );
      }
    } catch (error) {
      console.warn(
        'Cardinal social bridge unavailable; memory was still saved.',
        error,
      );
    }

    await sleep(Math.random() * 1000);

    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberConversation',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),

    type: v.union(
      v.literal('start'),
      v.literal('continue'),
      v.literal('leave'),
    ),

    messageUuid: v.string(),
  },

  handler: async (ctx, args) => {
    let completionFn;

    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;

      case 'continue':
        completionFn = continueConversationMessage;
        break;

      case 'leave':
        completionFn = leaveConversationMessage;
        break;

      default:
        assertNever(args.type);
    }

    const text = await completionFn(
      ctx,
      args.worldId,
      args.conversationId as GameId<'conversations'>,
      args.playerId as GameId<'players'>,
      args.otherPlayerId as GameId<'players'>,
    );

    await ctx.runMutation(
      internal.aiTown.agent.agentSendMessage,
      {
        worldId: args.worldId,
        conversationId: args.conversationId,
        agentId: args.agentId,
        playerId: args.playerId,
        text,
        messageUuid: args.messageUuid,

        // Оставляем поддержку старого механизма,
        // хотя теперь agent.ts умеет жёстко
        // завершать слишком долгие разговоры.
        leaveConversation: args.type === 'leave',

        operationId: args.operationId,
      },
    );
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    operationId: v.string(),
  },

  handler: async (ctx, args) => {
    const { player, agent } = args;

    const map = new WorldMap(args.map);

    const now = Date.now();

    const justLeftConversation =
      agent.lastConversation !== undefined &&
      now <
        agent.lastConversation +
          CONVERSATION_COOLDOWN;

    const recentlyAttemptedInvite =
      agent.lastInviteAttempt !== undefined &&
      now <
        agent.lastInviteAttempt +
          CONVERSATION_COOLDOWN;

    const recentActivity =
      player.activity !== undefined &&
      now <
        player.activity.until +
          ACTIVITY_COOLDOWN;

    // =====================================================
    // 1. ПОСЛЕ РАЗГОВОРА NPC ОБЯЗАТЕЛЬНО РАСХОДИТСЯ
    // =====================================================

    if (justLeftConversation) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    // =====================================================
    // 2. ЕСЛИ НЕДАВНО ПЫТАЛСЯ КОГО-ТО ПОЗВАТЬ,
    //    НЕ ПРИЛИПАЕМ СРАЗУ К ДРУГОМУ NPC.
    //    ИДЁМ ГУЛЯТЬ.
    // =====================================================

    if (recentlyAttemptedInvite) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    // =====================================================
    // 3. ЕСЛИ ТОЛЬКО ЧТО ЗАКОНЧИЛ АКТИВНОСТЬ —
    //    ТОЖЕ НЕМНОГО ПРОГУЛЯТЬСЯ.
    // =====================================================

    if (recentActivity) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    // =====================================================
    // 4. ЕСЛИ NPC УЖЕ КУДА-ТО ИДЁТ —
    //    НЕ МЕШАЕМ ДВИЖЕНИЮ.
    //
    // agent.ts снова вызовет нас после завершения пути.
    // =====================================================

    if (player.pathfinding) {
      await finishWithoutAction(
        ctx,
        args,
      );

      return;
    }

    // =====================================================
    // 5. ОБЫЧНЫЙ ВЫБОР ПОВЕДЕНИЯ
    //
    // 45% — прогулка
    // 30% — деятельность
    // 25% — социальное действие
    //
    // Это специально делает город менее "липким".
    // =====================================================

    const roll = Math.random();

    // -----------------------------------------------------
    // ПРОГУЛКА
    // -----------------------------------------------------

    if (roll < 0.45) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    // -----------------------------------------------------
    // ДЕЯТЕЛЬНОСТЬ
    // -----------------------------------------------------

    if (roll < 0.75) {
      let cardinalActivity = null;

      try {
        cardinalActivity = await ctx.runQuery(
          (internal as any).cardinal.context.getActivityHint,
          {
            worldId: args.worldId,
            playerId: player.id,
          },
        );
      } catch (error) {
        console.warn(
          'Cardinal activity hint unavailable; using default activity.',
          error,
        );
      }

      const activity =
        cardinalActivity ??
        ACTIVITIES[
          Math.floor(
            Math.random() *
              ACTIVITIES.length,
          )
        ];

      await sleep(
        Math.random() * 500,
      );

      await ctx.runMutation(
        api.aiTown.main.sendInput,
        {
          worldId: args.worldId,
          name: 'finishDoSomething',

          args: {
            operationId:
              args.operationId,

            agentId:
              agent.id,

            activity: {
              description:
                activity.description,

              emoji:
                activity.emoji,

              until:
                Date.now() +
                activity.duration,
            },
          },
        },
      );

      return;
    }

    // =====================================================
    // 6. СОЦИАЛЬНОЕ ДЕЙСТВИЕ
    // =====================================================

    let invitee = undefined;

    if (
      args.otherFreePlayers.length >
      0
    ) {
      invitee = await ctx.runQuery(
        internal.aiTown.agent
          .findConversationCandidate,
        {
          now,

          worldId:
            args.worldId,

          player:
            args.player,

          otherFreePlayers:
            args.otherFreePlayers,
        },
      );
    }

    // Если подходящего собеседника нет —
    // NPC не стоит столбом, а идёт гулять.
    if (!invitee) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    await sleep(
      Math.random() * 1000,
    );

    await ctx.runMutation(
      api.aiTown.main.sendInput,
      {
        worldId: args.worldId,

        name: 'finishDoSomething',

        args: {
          operationId:
            args.operationId,

          agentId:
            agent.id,

          invitee,
        },
      },
    );
  },
});

// =========================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =========================================================

async function finishWithDestination(
  ctx: any,
  args: any,
  destination: {
    x: number;
    y: number;
  },
) {
  await sleep(
    Math.random() * 500,
  );

  await ctx.runMutation(
    api.aiTown.main.sendInput,
    {
      worldId: args.worldId,

      name: 'finishDoSomething',

      args: {
        operationId:
          args.operationId,

        agentId:
          args.agent.id,

        destination,
      },
    },
  );
}

async function finishWithoutAction(
  ctx: any,
  args: any,
) {
  await sleep(
    Math.random() * 250,
  );

  await ctx.runMutation(
    api.aiTown.main.sendInput,
    {
      worldId: args.worldId,

      name: 'finishDoSomething',

      args: {
        operationId:
          args.operationId,

        agentId:
          args.agent.id,
      },
    },
  );
}

function wanderDestination(
  worldMap: WorldMap,
) {
  // Не отправляем NPC прямо к краю карты.
  const margin = 2;

  const usableWidth =
    Math.max(
      1,
      worldMap.width -
        margin * 2,
    );

  const usableHeight =
    Math.max(
      1,
      worldMap.height -
        margin * 2,
    );

  return {
    x:
      margin +
      Math.floor(
        Math.random() *
          usableWidth,
      ),

    y:
      margin +
      Math.floor(
        Math.random() *
          usableHeight,
      ),
  };
}
