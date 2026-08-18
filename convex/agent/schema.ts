import { v } from 'convex/values';
import { playerId, conversationId } from '../aiTown/ids';
import { defineTable } from 'convex/server';
import { EMBEDDING_DIMENSION } from '../util/llm';

export const memoryFields = {
  playerId,
  description: v.string(),
  embeddingId: v.id('memoryEmbeddings'),
  importance: v.number(),
  lastAccess: v.number(),

  data: v.union(
    v.object({
      type: v.literal('relationship'),

      // The player this relationship is about.
      playerId,

      // -100 = complete distrust
      // 0 = neutral
      // 100 = complete trust
      trust: v.number(),

      // -100 = strong dislike
      // 0 = neutral
      // 100 = strong affection
      affinity: v.number(),

      // -100 = contempt
      // 0 = neutral
      // 100 = deep respect
      respect: v.number(),

      // 0 = no active conflict
      // 100 = extreme hostility/conflict
      conflict: v.number(),

      // Timestamp of the latest meaningful relationship update.
      updatedAt: v.number(),
    }),

    v.object({
      type: v.literal('conversation'),
      conversationId,

      // The other player(s) in the conversation.
      playerIds: v.array(playerId),
    }),

    v.object({
      type: v.literal('reflection'),
      relatedMemoryIds: v.array(v.id('memories')),
    }),
  ),
};

export const memoryTables = {
  memories: defineTable(memoryFields)
    .index('embeddingId', ['embeddingId'])
    .index('playerId_type', ['playerId', 'data.type'])
    .index('playerId', ['playerId']),

  memoryEmbeddings: defineTable({
    playerId,
    embedding: v.array(v.float64()),
  }).vectorIndex('embedding', {
    vectorField: 'embedding',
    filterFields: ['playerId'],
    dimensions: EMBEDDING_DIMENSION,
  }),
};

export const agentTables = {
  ...memoryTables,

  embeddingsCache: defineTable({
    textHash: v.bytes(),
    embedding: v.array(v.float64()),
  }).index('text', ['textHash']),
};
