import { v } from 'convex/values';
import {
  ActionCtx,
  DatabaseReader,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import {
  LLMMessage,
  chatCompletion,
  fetchEmbedding,
} from '../util/llm';
import { asyncMap } from '../util/asyncMap';
import {
  GameId,
  agentId,
  conversationId,
  playerId,
} from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';
import { memoryFields } from './schema';

// How long to wait before updating a memory's last access time.
export const MEMORY_ACCESS_THROTTLE = 300_000;

// We fetch 10x the number of memories by relevance,
// to have more candidates for sorting by
// relevance + recency + importance.
const MEMORY_OVERFETCH = 10;

const selfInternal = internal.agent.memory;

export type Memory = Doc<'memories'>;
export type MemoryType = Memory['data']['type'];

export type MemoryOfType<T extends MemoryType> = Omit<
  Memory,
  'data'
> & {
  data: Extract<Memory['data'], { type: T }>;
};

type RelationshipState = {
  trust: number;
  affinity: number;
  respect: number;
  conflict: number;
};

type RelationshipAssessment = {
  trustDelta: number;
  affinityDelta: number;
  respectDelta: number;
  conflictDelta: number;
  reason: string;
};

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function cleanJsonResponse(content: string) {
  return content
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function rememberConversation(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  agentId: GameId<'agents'>,
  playerId: GameId<'players'>,
  conversationId: GameId<'conversations'>,
) {
  const data = await ctx.runQuery(
    selfInternal.loadConversation,
    {
      worldId,
      playerId,
      conversationId,
    },
  );

  const { player, otherPlayer } = data;

  const messages = await ctx.runQuery(
    selfInternal.loadMessages,
    {
      worldId,
      conversationId,
    },
  );

  if (!messages.length) {
    return;
  }

  const llmMessages: LLMMessage[] = [
    {
      role: 'user',
      content: `You are ${player.name}, and you just finished a conversation with ${otherPlayer.name}.

Summarize the conversation from ${player.name}'s perspective.

Rules:
- Preserve the language of the conversation.
- If the conversation was mainly in Russian, write the memory in natural Russian.
- If it was mainly in English, write the memory in English.
- If both languages were used, use the language that dominated the conversation.
- Use first-person perspective.
- Include emotionally important details.
- Mention whether you liked, disliked, trusted, distrusted, appreciated, feared, respected, or became annoyed with the other person when relevant.
- Preserve important facts, promises, conflicts, requests, opinions, names, and relationship changes.
- Do not invent events that did not happen.
- This summary will become your long-term memory and may affect future behavior.`,
    },
  ];

  const authors = new Set<GameId<'players'>>();

  for (const message of messages) {
    const author =
      message.author === player.id
        ? player
        : otherPlayer;

    authors.add(
      author.id as GameId<'players'>,
    );

    const recipient =
      message.author === player.id
        ? otherPlayer
        : player;

    llmMessages.push({
      role: 'user',
      content:
        `${author.name} to ${recipient.name}: ${message.text}`,
    });
  }

  llmMessages.push({
    role: 'user',
    content: 'Summary:',
  });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 500,
  });

  const description =
    `Conversation with ${otherPlayer.name} at ${new Date(
      data.conversation._creationTime,
    ).toLocaleString()}: ${content}`;

  const importance =
    await calculateImportance(description);

  const { embedding } =
    await fetchEmbedding(description);

  authors.delete(
    player.id as GameId<'players'>,
  );

  await ctx.runMutation(
    selfInternal.insertMemory,
    {
      agentId,
      playerId: player.id,
      description,
      importance,
      lastAccess:
        messages[messages.length - 1]._creationTime,

      data: {
        type: 'conversation',
        conversationId,
        playerIds: [...authors],
      },

      embedding,
    },
  );

  // Update persistent relationship state
  // after the conversation has been remembered.
  await updateRelationshipFromConversation(
    ctx,
    agentId,
    player,
    otherPlayer,
    content,
  );

  await reflectOnMemories(
    ctx,
    worldId,
    playerId,
  );

  return description;
}

async function updateRelationshipFromConversation(
  ctx: ActionCtx,
  agentId: GameId<'agents'>,
  player: {
    id: string;
    name: string;
  },
  otherPlayer: {
    id: string;
    name: string;
  },
  conversationSummary: string,
) {
  const existingRelationship =
    await ctx.runQuery(
      selfInternal.getRelationshipWithPlayer,
      {
        playerId:
          player.id as GameId<'players'>,

        otherPlayerId:
          otherPlayer.id as GameId<'players'>,
      },
    );

  const current: RelationshipState =
  const current: RelationshipState =
  existingRelationship &&
  existingRelationship.data.type === 'relationship'
    ? {
        trust:
          existingRelationship.data.trust,
        affinity:
          existingRelationship.data.affinity,
        respect:
          existingRelationship.data.respect,
        conflict:
          existingRelationship.data.conflict,
      }
    : {
        trust: 0,
        affinity: 0,
        respect: 0,
        conflict: 0,
      };

  const relationshipPrompt = `
You are ${player.name}.

You have just finished a conversation with ${otherPlayer.name}.

Current relationship state:

trust: ${current.trust}
affinity: ${current.affinity}
respect: ${current.respect}
conflict: ${current.conflict}

Conversation memory:

${conversationSummary}

Evaluate how THIS conversation should change your relationship with ${otherPlayer.name}.

The values mean:

trust:
-100 = complete distrust
0 = neutral
100 = complete trust

affinity:
-100 = strong dislike
0 = neutral
100 = strong affection

respect:
-100 = contempt
0 = neutral
100 = deep respect

conflict:
0 = no active conflict
100 = extreme hostility

Return ONLY valid JSON with this exact structure:

{
  "trustDelta": 0,
  "affinityDelta": 0,
  "respectDelta": 0,
  "conflictDelta": 0,
  "reason": "..."
}

Rules:

- Each delta must normally be between -10 and 10.
- Only extraordinary events may reach -20 or 20.
- Ordinary friendly conversation should cause only small changes.
- A neutral conversation may produce zero change.
- Betrayal, lying, threats or serious insults may strongly reduce trust or affinity.
- Help, honesty, loyalty, protection and fulfilled promises may increase trust.
- Competence, courage, wisdom or integrity may increase respect.
- Open hostility may increase conflict.
- Reconciliation may reduce conflict.
- Do not invent events.
- Relationship changes must come only from the conversation memory.
- Preserve the dominant language of the conversation in "reason".
`;

  const { content } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content: relationshipPrompt,
      },
    ],
    temperature: 0.2,
    max_tokens: 250,
  });

  let assessment: RelationshipAssessment;

  try {
    const parsed = JSON.parse(
      cleanJsonResponse(content),
    );

    assessment = {
      trustDelta: clamp(
        safeNumber(parsed.trustDelta),
        -20,
        20,
      ),

      affinityDelta: clamp(
        safeNumber(parsed.affinityDelta),
        -20,
        20,
      ),

      respectDelta: clamp(
        safeNumber(parsed.respectDelta),
        -20,
        20,
      ),

      conflictDelta: clamp(
        safeNumber(parsed.conflictDelta),
        -20,
        20,
      ),

      reason:
        typeof parsed.reason === 'string'
          ? parsed.reason
          : '',
    };
  } catch (error) {
    console.error(
      'Could not parse relationship assessment:',
      content,
      error,
    );

    return;
  }

  const next: RelationshipState = {
    trust: clamp(
      current.trust +
        assessment.trustDelta,
      -100,
      100,
    ),

    affinity: clamp(
      current.affinity +
        assessment.affinityDelta,
      -100,
      100,
    ),

    respect: clamp(
      current.respect +
        assessment.respectDelta,
      -100,
      100,
    ),

    conflict: clamp(
      current.conflict +
        assessment.conflictDelta,
      0,
      100,
    ),
  };

  const relationshipDescription = `
Relationship with ${otherPlayer.name}.

Trust: ${next.trust}
Affinity: ${next.affinity}
Respect: ${next.respect}
Conflict: ${next.conflict}

Latest change:
${assessment.reason}
`.trim();

  const relationshipImportance =
    await calculateImportance(
      relationshipDescription,
    );

  const {
    embedding: relationshipEmbedding,
  } = await fetchEmbedding(
    relationshipDescription,
  );

  // We intentionally create a new relationship memory
  // instead of overwriting the old one.
  //
  // This gives us a history of relationship changes,
  // which will later be useful for Cardinal observation
  // and auditing.
  await ctx.runMutation(
    selfInternal.insertMemory,
    {
      agentId,

      playerId:
        player.id as GameId<'players'>,

      description:
        relationshipDescription,

      importance:
        relationshipImportance,

      lastAccess: Date.now(),

      data: {
        type: 'relationship',

        playerId:
          otherPlayer.id as GameId<'players'>,

        trust: next.trust,
        affinity: next.affinity,
        respect: next.respect,
        conflict: next.conflict,
        updatedAt: Date.now(),
      },

      embedding:
        relationshipEmbedding,
    },
  );
}

export const getRelationshipWithPlayer =
  internalQuery({
    args: {
      playerId,
      otherPlayerId: playerId,
    },

    handler: async (ctx, args) => {
      const relationships =
        await ctx.db
          .query('memories')
          .withIndex(
            'playerId_type',
            (q) =>
              q
                .eq(
                  'playerId',
                  args.playerId,
                )
                .eq(
                  'data.type',
                  'relationship',
                ),
          )
          .order('desc')
          .collect();

      const relationship =
        relationships.find(
          (memory) =>
            memory.data.type ===
              'relationship' &&
            memory.data.playerId ===
              args.otherPlayerId,
        );

      if (
        !relationship ||
        relationship.data.type !==
          'relationship'
      ) {
        return null;
      }

      return relationship;
    },
  });

export const loadConversation =
  internalQuery({
    args: {
      worldId: v.id('worlds'),
      playerId,
      conversationId,
    },

    handler: async (ctx, args) => {
      const world =
        await ctx.db.get(args.worldId);

      if (!world) {
        throw new Error(
          `World ${args.worldId} not found`,
        );
      }

      const player =
        world.players.find(
          (p) =>
            p.id === args.playerId,
        );

      if (!player) {
        throw new Error(
          `Player ${args.playerId} not found`,
        );
      }

      const playerDescription =
        await ctx.db
          .query('playerDescriptions')
          .withIndex(
            'worldId',
            (q) =>
              q
                .eq(
                  'worldId',
                  args.worldId,
                )
                .eq(
                  'playerId',
                  args.playerId,
                ),
          )
          .first();

      if (!playerDescription) {
        throw new Error(
          `Player description for ${args.playerId} not found`,
        );
      }

      const conversation =
        await ctx.db
          .query(
            'archivedConversations',
          )
          .withIndex(
            'worldId',
            (q) =>
              q
                .eq(
                  'worldId',
                  args.worldId,
                )
                .eq(
                  'id',
                  args.conversationId,
                ),
          )
          .first();

      if (!conversation) {
        throw new Error(
          `Conversation ${args.conversationId} not found`,
        );
      }

      const otherParticipator =
        await ctx.db
          .query(
            'participatedTogether',
          )
          .withIndex(
            'conversation',
            (q) =>
              q
                .eq(
                  'worldId',
                  args.worldId,
                )
                .eq(
                  'player1',
                  args.playerId,
                )
                .eq(
                  'conversationId',
                  args.conversationId,
                ),
          )
          .first();

      if (!otherParticipator) {
        throw new Error(
          `Couldn't find other participant in conversation ${args.conversationId} with player ${args.playerId}`,
        );
      }

      const otherPlayerId =
        otherParticipator.player2;

      let otherPlayer:
        | SerializedPlayer
        | Doc<'archivedPlayers'>
        | null =
        world.players.find(
          (p) =>
            p.id === otherPlayerId,
        ) ?? null;

      if (!otherPlayer) {
        otherPlayer =
          await ctx.db
            .query('archivedPlayers')
            .withIndex(
              'worldId',
              (q) =>
                q
                  .eq(
                    'worldId',
                    world._id,
                  )
                  .eq(
                    'id',
                    otherPlayerId,
                  ),
            )
            .first();
      }

      if (!otherPlayer) {
        throw new Error(
          `Conversation ${args.conversationId} other player not found`,
        );
      }

      const otherPlayerDescription =
        await ctx.db
          .query('playerDescriptions')
          .withIndex(
            'worldId',
            (q) =>
              q
                .eq(
                  'worldId',
                  args.worldId,
                )
                .eq(
                  'playerId',
                  otherPlayerId,
                ),
          )
          .first();

      if (!otherPlayerDescription) {
        throw new Error(
          `Player description for ${otherPlayerId} not found`,
        );
      }

      return {
        player: {
          ...player,
          name:
            playerDescription.name,
        },

        conversation,

        otherPlayer: {
          ...otherPlayer,
          name:
            otherPlayerDescription.name,
        },
      };
    },
  });

export async function searchMemories(
  ctx: ActionCtx,
  playerId: GameId<'players'>,
  searchEmbedding: number[],
  n: number = 3,
) {
  const candidates =
    await ctx.vectorSearch(
      'memoryEmbeddings',
      'embedding',
      {
        vector: searchEmbedding,

        filter: (q) =>
          q.eq(
            'playerId',
            playerId,
          ),

        limit:
          n * MEMORY_OVERFETCH,
      },
    );

  const rankedMemories =
    await ctx.runMutation(
      selfInternal.rankAndTouchMemories,
      {
        candidates,
        n,
      },
    );

  return rankedMemories.map(
    ({ memory }) => memory,
  );
}

function makeRange(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  return [min, max] as const;
}

function normalize(
  value: number,
  range: readonly [number, number],
) {
  const [min, max] = range;

  if (max === min) {
    return 1;
  }

  return (
    (value - min) /
    (max - min)
  );
}

export const rankAndTouchMemories =
  internalMutation({
    args: {
      candidates: v.array(
        v.object({
          _id: v.id(
            'memoryEmbeddings',
          ),
          _score: v.number(),
        }),
      ),

      n: v.number(),
    },

    handler: async (ctx, args) => {
      const ts = Date.now();

      const relatedMemories =
        await asyncMap(
          args.candidates,
          async ({ _id }) => {
            const memory =
              await ctx.db
                .query('memories')
                .withIndex(
                  'embeddingId',
                  (q) =>
                    q.eq(
                      'embeddingId',
                      _id,
                    ),
                )
                .first();

            if (!memory) {
              throw new Error(
                `Memory for embedding ${_id} not found`,
              );
            }

            return memory;
          },
        );

      if (
        relatedMemories.length === 0
      ) {
        return [];
      }

      const recencyScore =
        relatedMemories.map(
          (memory) => {
            const hoursSinceAccess =
              (ts -
                memory.lastAccess) /
              1000 /
              60 /
              60;

            return (
              0.99 **
              Math.floor(
                hoursSinceAccess,
              )
            );
          },
        );

      const relevanceRange =
        makeRange(
          args.candidates.map(
            (c) => c._score,
          ),
        );

      const importanceRange =
        makeRange(
          relatedMemories.map(
            (m) => m.importance,
          ),
        );

      const recencyRange =
        makeRange(recencyScore);

      const memoryScores =
        relatedMemories.map(
          (memory, idx) => ({
            memory,

            overallScore:
              normalize(
                args.candidates[idx]
                  ._score,
                relevanceRange,
              ) +
              normalize(
                memory.importance,
                importanceRange,
              ) +
              normalize(
                recencyScore[idx],
                recencyRange,
              ),
          }),
        );

      memoryScores.sort(
        (a, b) =>
          b.overallScore -
          a.overallScore,
      );

      const accessed =
        memoryScores.slice(
          0,
          args.n,
        );

      await asyncMap(
        accessed,
        async ({ memory }) => {
          if (
            memory.lastAccess <
            ts -
              MEMORY_ACCESS_THROTTLE
          ) {
            await ctx.db.patch(
              memory._id,
              {
                lastAccess: ts,
              },
            );
          }
        },
      );

      return accessed;
    },
  });

export const loadMessages =
  internalQuery({
    args: {
      worldId: v.id('worlds'),
      conversationId,
    },

    handler: async (
      ctx,
      args,
    ): Promise<
      Doc<'messages'>[]
    > => {
      const messages =
        await ctx.db
          .query('messages')
          .withIndex(
            'conversationId',
            (q) =>
              q
                .eq(
                  'worldId',
                  args.worldId,
                )
                .eq(
                  'conversationId',
                  args.conversationId,
                ),
          )
          .collect();

      return messages;
    },
  });

async function calculateImportance(
  description: string,
) {
  const {
    content: importanceRaw,
  } = await chatCompletion({
    messages: [
      {
        role: 'user',

        content: `On the scale of 0 to 9, where 0 is purely mundane (e.g., brushing teeth, making bed) and 9 is extremely poignant (e.g., a break up, college acceptance), rate the likely poignancy of the following piece of memory.

Memory: ${description}

Answer on a scale of 0 to 9.
Respond with number only, e.g. "5"`,
      },
    ],

    temperature: 0.0,
    max_tokens: 1,
  });

  let importance =
    parseFloat(importanceRaw);

  if (isNaN(importance)) {
    importance = +(
      importanceRaw.match(
        /\d+/,
      )?.[0] ?? NaN
    );
  }

  if (isNaN(importance)) {
    console.debug(
      'Could not parse memory importance from: ',
      importanceRaw,
    );

    importance = 5;
  }

  return clamp(
    importance,
    0,
    9,
  );
}

const {
  embeddingId: _embeddingId,
  ...memoryFieldsWithoutEmbeddingId
} = memoryFields;

export const insertMemory =
  internalMutation({
    args: {
      agentId,
      embedding: v.array(
        v.float64(),
      ),

      ...memoryFieldsWithoutEmbeddingId,
    },

    handler: async (
      ctx,
      {
        agentId: _,
        embedding,
        ...memory
      },
    ): Promise<void> => {
      const embeddingId =
        await ctx.db.insert(
          'memoryEmbeddings',
          {
            playerId:
              memory.playerId,
            embedding,
          },
        );

      await ctx.db.insert(
        'memories',
        {
          ...memory,
          embeddingId,
        },
      );
    },
  });

export const insertReflectionMemories =
  internalMutation({
    args: {
      worldId: v.id('worlds'),
      playerId,

      reflections: v.array(
        v.object({
          description: v.string(),

          relatedMemoryIds:
            v.array(
              v.id('memories'),
            ),

          importance: v.number(),

          embedding: v.array(
            v.float64(),
          ),
        }),
      ),
    },

    handler: async (
      ctx,
      {
        playerId,
        reflections,
      },
    ) => {
      const lastAccess =
        Date.now();

      for (const {
        embedding,
        relatedMemoryIds,
        ...rest
      } of reflections) {
        const embeddingId =
          await ctx.db.insert(
            'memoryEmbeddings',
            {
              playerId,
              embedding,
            },
          );

        await ctx.db.insert(
          'memories',
          {
            playerId,
            embeddingId,
            lastAccess,
            ...rest,

            data: {
              type: 'reflection',
              relatedMemoryIds,
            },
          },
        );
      }
    },
  });

async function reflectOnMemories(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  playerId: GameId<'players'>,
) {
  const {
    memories,
    lastReflectionTs,
    name,
  } = await ctx.runQuery(
    internal.agent.memory
      .getReflectionMemories,
    {
      worldId,
      playerId,
      numberOfItems: 100,
    },
  );

  const sumOfImportanceScore =
    memories
      .filter(
        (m) =>
          m._creationTime >
          (lastReflectionTs ??
            0),
      )
      .reduce(
        (acc, curr) =>
          acc +
          curr.importance,
        0,
      );

  const shouldReflect =
    sumOfImportanceScore >= 25;

  if (!shouldReflect) {
    return false;
  }

  console.debug(
    'sum of importance score = ',
    sumOfImportanceScore,
  );

  console.debug(
    'Reflecting...',
  );

  const prompt = [
    '[no prose]',
    '[Output only JSON]',

    `You are ${name}, statements about you:`,

    'Preserve the dominant language of the memories when writing insights.',

    'If the memories are mainly in Russian, write insights in Russian.',

    'If the memories are mainly in English, write insights in English.',

    'Focus especially on recurring relationships, trust, distrust, sympathy, irritation, cooperation, conflict, promises, loyalty, fear, respect, and changes in attitude toward other people.',

    'Do not invent facts that are not supported by the memories.',
  ];

  memories.forEach(
    (m, idx) => {
      prompt.push(
        `Statement ${idx}: ${m.description}`,
      );
    },
  );

  prompt.push(
    'What 3 high-level insights can you infer from the above statements?',
  );

  prompt.push(
    'Return ONLY a valid JSON array. Each item must contain "insight" and "statementIds". Example: [{"insight":"...","statementIds":[1,2]},{"insight":"...","statementIds":[3]}]',
  );

  const {
    content: reflection,
  } = await chatCompletion({
    messages: [
      {
        role: 'user',
        content:
          prompt.join('\n'),
      },
    ],
  });

  try {
    const cleaned =
      cleanJsonResponse(
        reflection,
      );

    const insights =
      JSON.parse(cleaned) as {
        insight: string;
        statementIds: number[];
      }[];

    const memoriesToSave =
      await asyncMap(
        insights,
        async (item) => {
          const validIds =
            item.statementIds.filter(
              (idx) =>
                Number.isInteger(
                  idx,
                ) &&
                idx >= 0 &&
                idx <
                  memories.length,
            );

          const relatedMemoryIds =
            validIds.map(
              (idx) =>
                memories[idx]._id,
            );

          const importance =
            await calculateImportance(
              item.insight,
            );

          const { embedding } =
            await fetchEmbedding(
              item.insight,
            );

          console.debug(
            'adding reflection memory...',
            item.insight,
          );

          return {
            description:
              item.insight,

            embedding,
            importance,
            relatedMemoryIds,
          };
        },
      );

    await ctx.runMutation(
      selfInternal
        .insertReflectionMemories,
      {
        worldId,
        playerId,
        reflections:
          memoriesToSave,
      },
    );
  } catch (e) {
    console.error(
      'error saving or parsing reflection',
      e,
    );

    console.debug(
      'reflection',
      reflection,
    );

    return false;
  }

  return true;
}

export const getReflectionMemories =
  internalQuery({
    args: {
      worldId: v.id('worlds'),
      playerId,
      numberOfItems: v.number(),
    },

    handler: async (
      ctx,
      args,
    ) => {
      const world =
        await ctx.db.get(
          args.worldId,
        );

      if (!world) {
        throw new Error(
          `World ${args.worldId} not found`,
        );
      }

      const player =
        world.players.find(
          (p) =>
            p.id === args.playerId,
        );

      if (!player) {
        throw new Error(
          `Player ${args.playerId} not found`,
        );
      }

      const playerDescription =
        await ctx.db
          .query(
            'playerDescriptions',
          )
          .withIndex(
            'worldId',
            (q) =>
              q
                .eq(
                  'worldId',
                  args.worldId,
                )
                .eq(
                  'playerId',
                  args.playerId,
                ),
          )
          .first();

      if (!playerDescription) {
        throw new Error(
          `Player description for ${args.playerId} not found`,
        );
      }

      const memories =
        await ctx.db
          .query('memories')
          .withIndex(
            'playerId',
            (q) =>
              q.eq(
                'playerId',
                player.id,
              ),
          )
          .order('desc')
          .take(
            args.numberOfItems,
          );

      const lastReflection =
        await ctx.db
          .query('memories')
          .withIndex(
            'playerId_type',
            (q) =>
              q
                .eq(
                  'playerId',
                  args.playerId,
                )
                .eq(
                  'data.type',
                  'reflection',
                ),
          )
          .order('desc')
          .first();

      return {
        name:
          playerDescription.name,

        memories,

        lastReflectionTs:
          lastReflection?._creationTime,
      };
    },
  });

export async function latestMemoryOfType<
  T extends MemoryType,
>(
  db: DatabaseReader,
  playerId: GameId<'players'>,
  type: T,
) {
  const entry =
    await db
      .query('memories')
      .withIndex(
        'playerId_type',
        (q) =>
          q
            .eq(
              'playerId',
              playerId,
            )
            .eq(
              'data.type',
              type,
            ),
      )
      .order('desc')
      .first();

  if (!entry) {
    return null;
  }

  return entry as MemoryOfType<T>;
}
