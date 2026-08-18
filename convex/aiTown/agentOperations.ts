import { v } from 'convex/values';
import { internalAction, internalQuery } from '../_generated/server';
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
  INVITE_ACCEPT_PROBABILITY,
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
        leaveConversation: args.type === 'leave',
        operationId: args.operationId,
      },
    );
  },
});
export const loadDoSomethingContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
  },

  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);

    if (!world) {
      throw new Error(`World not found: ${args.worldId}`);
    }

    const player = world.players.find(
      (p) => p.id === args.playerId,
    );

    if (!player) {
      throw new Error(`Player not found: ${args.playerId}`);
    }

    const agent = world.agents.find(
      (a) => a.id === args.agentId,
    );

    if (!agent) {
      throw new Error(`Agent not found: ${args.agentId}`);
    }

    const mapDoc = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) =>
        q.eq('worldId', args.worldId),
      )
      .unique();

    if (!mapDoc) {
      throw new Error(`Map not found for world ${args.worldId}`);
    }

    const {
      _id,
      _creationTime,
      worldId: _worldId,
      ...map
    } = mapDoc;

    const busyPlayers = new Set(
      world.conversations.flatMap((conversation) =>
        conversation.participants.map(
          (participant) => participant.playerId,
        ),
      ),
    );

    const otherFreePlayers = world.players.filter(
      (otherPlayer) =>
        otherPlayer.id !== player.id &&
        !busyPlayers.has(otherPlayer.id),
    );

    return {
      player,
      agent,
      map,
      otherFreePlayers,
    };
  },
});
export const agentDoSomethingLight = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    operationId: v.string(),
  },

  handler: async (ctx, args) => {
    const context = await ctx.runQuery(
      internal.aiTown.agentOperations.loadDoSomethingContext,
      {
        worldId: args.worldId,
        playerId: args.playerId,
        agentId: args.agentId,
      },
    );

    await ctx.runAction(
      internal.aiTown.agentOperations.agentDoSomething,
      {
        worldId: args.worldId,
        player: context.player,
        agent: context.agent,
        map: context.map,
        otherFreePlayers: context.otherFreePlayers,
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

    if (justLeftConversation) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    if (recentlyAttemptedInvite) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    if (recentActivity) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    if (player.pathfinding) {
      await finishWithoutAction(
        ctx,
        args,
      );

      return;
    }
let routineTarget = null;

try {
  routineTarget = await ctx.runQuery(
    (api as any).cityRoutine.getRoutineTarget,
    {
      worldId: args.worldId,
      playerId: player.id,
      now,
    },
  );
} catch (error) {
  console.warn(
    'City routine unavailable; falling back to default AI Town behavior.',
    error,
  );
}

if (routineTarget) {
  await finishWithDestination(
    ctx,
    args,
    routineTarget.destination,
  );

  return;
}
    const roll = Math.random();

    // 45% — прогулка
    if (roll < 0.45) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    // 30% — деятельность
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

    // 25% — социальное действие
    let invitee: GameId<'players'> | undefined = undefined;

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

    if (!invitee) {
      await finishWithDestination(
        ctx,
        args,
        wanderDestination(map),
      );

      return;
    }

    const inviteePlayer =
      args.otherFreePlayers.find(
        (p) => p.id === invitee,
      );

    // Людей не фильтруем отношениями NPC.
    if (
      inviteePlayer &&
      !inviteePlayer.human
    ) {
      const relationship =
        await ctx.runQuery(
          internal.agent.memory
            .getRelationshipWithPlayer,
          {
            playerId:
              invitee as GameId<'players'>,

            otherPlayerId:
              player.id as GameId<'players'>,
          },
        );

      let acceptanceProbability =
        INVITE_ACCEPT_PROBABILITY;

      if (
        relationship &&
        relationship.data.type ===
          'relationship'
      ) {
        const {
          trust,
          affinity,
          respect,
          conflict,
        } = relationship.data;

        acceptanceProbability +=
          affinity * 0.003;

        acceptanceProbability +=
          trust * 0.002;

        acceptanceProbability +=
          respect * 0.001;

        acceptanceProbability -=
          conflict * 0.004;

        acceptanceProbability =
          Math.max(
            0.08,
            Math.min(
              0.95,
              acceptanceProbability,
            ),
          );
      }

      const accepted =
        Math.random() <
        acceptanceProbability;

      if (!accepted) {
        console.log(
          `Agent ${invitee} would reject invite from ${player.id}.`,
        );

        await finishWithDestination(
          ctx,
          args,
          wanderDestination(map),
        );

        return;
      }
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
