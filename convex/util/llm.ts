// Ainkrad LLM adapter.
// OpenAI is preferred when OPENAI_API_KEY exists.
// Existing Convex vector index stays at 1024 dimensions.

const TOGETHER_EMBEDDING_DIMENSION = 768;
const OLLAMA_EMBEDDING_DIMENSION = 1024;

export const EMBEDDING_DIMENSION: number = 1024;

export interface LLMConfig {
  provider:
    | 'openai'
    | 'together'
    | 'ollama'
    | 'custom';

  url: string;
  chatModel: string;
  embeddingModel: string;
  stopWords: string[];
  apiKey: string | undefined;
}

export function detectMismatchedLLMProvider() {
  if (
    process.env.LLM_PROVIDER === 'openai' &&
    !process.env.OPENAI_API_KEY
  ) {
    throw new Error(
      'LLM_PROVIDER is openai but OPENAI_API_KEY is missing.',
    );
  }

  if (
    process.env.LLM_PROVIDER === 'together' &&
    !process.env.TOGETHER_API_KEY
  ) {
    throw new Error(
      'LLM_PROVIDER is together but TOGETHER_API_KEY is missing.',
    );
  }
}

export function getLLMConfig(): LLMConfig {
  const forcedProvider =
    process.env.LLM_PROVIDER;

  if (
    forcedProvider === 'openai' ||
    (
      !forcedProvider &&
      process.env.OPENAI_API_KEY
    )
  ) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is required for OpenAI.',
      );
    }

    return {
      provider: 'openai',

      url:
        'https://api.openai.com',

      chatModel:
        process.env.OPENAI_CHAT_MODEL ??
        'gpt-4o-mini',

      embeddingModel:
        process.env.OPENAI_EMBEDDING_MODEL ??
        'text-embedding-3-small',

      stopWords: [],

      apiKey:
        process.env.OPENAI_API_KEY,
    };
  }

  if (
    forcedProvider === 'together' ||
    (
      !forcedProvider &&
      process.env.TOGETHER_API_KEY
    )
  ) {
    if (!process.env.TOGETHER_API_KEY) {
      throw new Error(
        'TOGETHER_API_KEY is required for Together.',
      );
    }

    if (
      EMBEDDING_DIMENSION !==
      TOGETHER_EMBEDDING_DIMENSION
    ) {
      throw new Error(
        `Together embeddings require ${TOGETHER_EMBEDDING_DIMENSION} dimensions.`,
      );
    }

    return {
      provider: 'together',

      url:
        'https://api.together.xyz',

      chatModel:
        process.env.TOGETHER_CHAT_MODEL ??
        'meta-llama/Llama-3-8b-chat-hf',

      embeddingModel:
        process.env.TOGETHER_EMBEDDING_MODEL ??
        'togethercomputer/m2-bert-80M-8k-retrieval',

      stopWords: [
        '<|eot_id|>',
      ],

      apiKey:
        process.env.TOGETHER_API_KEY,
    };
  }

  if (
    forcedProvider === 'custom' ||
    (
      !forcedProvider &&
      process.env.LLM_API_URL
    )
  ) {
    const url =
      process.env.LLM_API_URL;

    const chatModel =
      process.env.LLM_MODEL;

    const embeddingModel =
      process.env.LLM_EMBEDDING_MODEL;

    if (!url) {
      throw new Error(
        'LLM_API_URL is required.',
      );
    }

    if (!chatModel) {
      throw new Error(
        'LLM_MODEL is required.',
      );
    }

    if (!embeddingModel) {
      throw new Error(
        'LLM_EMBEDDING_MODEL is required.',
      );
    }

    return {
      provider: 'custom',

      url,

      chatModel,

      embeddingModel,

      stopWords: [],

      apiKey:
        process.env.LLM_API_KEY,
    };
  }

  if (
    EMBEDDING_DIMENSION !==
    OLLAMA_EMBEDDING_DIMENSION
  ) {
    throw new Error(
      `Ollama embeddings require ${OLLAMA_EMBEDDING_DIMENSION} dimensions.`,
    );
  }

  return {
    provider: 'ollama',

    url:
      process.env.OLLAMA_HOST ??
      'http://127.0.0.1:11434',

    chatModel:
      process.env.OLLAMA_MODEL ??
      'llama3',

    embeddingModel:
      process.env.OLLAMA_EMBEDDING_MODEL ??
      'mxbai-embed-large',

    stopWords: [
      '<|eot_id|>',
    ],

    apiKey: undefined,
  };
}

const authHeaders = (
  config: LLMConfig,
): Record<string, string> => {
  if (!config.apiKey) {
    return {};
  }

  return {
    Authorization:
      `Bearer ${config.apiKey}`,
  };
};

// =====================================================
// CHAT
// =====================================================

export async function chatCompletion(
  body:
    Omit<
      CreateChatCompletionRequest,
      'model'
    > & {
      model?:
        CreateChatCompletionRequest['model'];
      stream?: false | null | undefined;
    },
): Promise<{
  content: string;
  retries: number;
  ms: number;
}>;

export async function chatCompletion(
  body:
    Omit<
      CreateChatCompletionRequest,
      'model'
    > & {
      model?:
        CreateChatCompletionRequest['model'];
      stream?: true;
    },
): Promise<{
  content: ChatCompletionContent;
  retries: number;
  ms: number;
}>;

export async function chatCompletion(
  body:
    Omit<
      CreateChatCompletionRequest,
      'model'
    > & {
      model?:
        CreateChatCompletionRequest['model'];
    },
) {
  const config =
    getLLMConfig();

  body.model =
    body.model ??
    config.chatModel;

  const stopWords =
    body.stop
      ? (
          typeof body.stop ===
          'string'
            ? [body.stop]
            : [...body.stop]
        )
      : [];

  stopWords.push(
    ...config.stopWords,
  );

  const {
    result: content,
    retries,
    ms,
  } =
    await retryWithBackoff(
      async () => {
        const result =
          await fetch(
            config.url +
              '/v1/chat/completions',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                ...authHeaders(
                  config,
                ),
              },

              body:
                JSON.stringify(
                  body,
                ),
            },
          );

        if (!result.ok) {
          const error =
            await result.text();

          console.error({
            provider:
              config.provider,
            model:
              body.model,
            error,
          });

          if (
            result.status ===
              404 &&
            config.provider ===
              'ollama'
          ) {
            await tryPullOllama(
              body.model!,
              error,
            );
          }

          throw {
            retry:
              result.status ===
                429 ||
              result.status >=
                500,

            error:
              new Error(
                `Chat completion failed with code ${result.status}: ${error}`,
              ),
          };
        }

        if (body.stream) {
          return new ChatCompletionContent(
            result.body!,
            stopWords,
          );
        }

        const json =
          (
            await result.json()
          ) as CreateChatCompletionResponse;

        const content =
          json.choices?.[0]
            ?.message
            ?.content;

        if (
          content ===
          undefined
        ) {
          throw new Error(
            'Unexpected chat result: ' +
              JSON.stringify(
                json,
              ),
          );
        }

        return content;
      },
    );

  return {
    content,
    retries,
    ms,
  };
}

// =====================================================
// EMBEDDINGS
// =====================================================

export async function fetchEmbeddingBatch(
  texts: string[],
) {
  const config =
    getLLMConfig();

  if (
    config.provider ===
    'ollama'
  ) {
    return {
      ollama:
        true as const,

      embeddings:
        await Promise.all(
          texts.map(
            async (text) =>
              (
                await ollamaFetchEmbedding(
                  text,
                )
              ).embedding,
          ),
        ),
    };
  }

  const {
    result: json,
    retries,
    ms,
  } =
    await retryWithBackoff(
      async () => {
        const payload: {
          model: string;
          input: string[];
          dimensions?: number;
        } = {
          model:
            config.embeddingModel,

          input:
            texts.map(
              (text) =>
                text.replace(
                  /\n/g,
                  ' ',
                ),
            ),
        };

        // OpenAI text-embedding-3 models
        // support reduced dimensions.
        // Keep 1024 because Convex vector
        // index already uses 1024.
        if (
          config.provider ===
          'openai'
        ) {
          payload.dimensions =
            EMBEDDING_DIMENSION;
        }

        const result =
          await fetch(
            config.url +
              '/v1/embeddings',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                ...authHeaders(
                  config,
                ),
              },

              body:
                JSON.stringify(
                  payload,
                ),
            },
          );

        if (!result.ok) {
          const error =
            await result.text();

          throw {
            retry:
              result.status ===
                429 ||
              result.status >=
                500,

            error:
              new Error(
                `Embedding failed with code ${result.status}: ${error}`,
              ),
          };
        }

        return (
          await result.json()
        ) as CreateEmbeddingResponse;
      },
    );

  if (
    json.data.length !==
    texts.length
  ) {
    throw new Error(
      `Unexpected number of embeddings: expected ${texts.length}, received ${json.data.length}`,
    );
  }

  const allEmbeddings =
    [...json.data];

  allEmbeddings.sort(
    (a, b) =>
      a.index - b.index,
  );

  for (
    const item of
      allEmbeddings
  ) {
    if (
      item.embedding
        .length !==
      EMBEDDING_DIMENSION
    ) {
      throw new Error(
        `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSION}, received ${item.embedding.length}`,
      );
    }
  }

  return {
    ollama:
      false as const,

    embeddings:
      allEmbeddings.map(
        ({
          embedding,
        }) => embedding,
      ),

    usage:
      json.usage
        ?.total_tokens,

    retries,
    ms,
  };
}

export async function fetchEmbedding(
  text: string,
) {
  const {
    embeddings,
    ...stats
  } =
    await fetchEmbeddingBatch(
      [text],
    );

  return {
    embedding:
      embeddings[0],

    ...stats,
  };
}

// =====================================================
// MODERATION
// =====================================================

export async function fetchModeration(
  content: string,
) {
  const config =
    getLLMConfig();

  // The AI Town code expects
  // a moderation-like result.
  // Keep using the configured provider.
  const {
    result: flagged,
  } =
    await retryWithBackoff(
      async () => {
        const result =
          await fetch(
            config.url +
              '/v1/moderations',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                ...authHeaders(
                  config,
                ),
              },

              body:
                JSON.stringify(
                  {
                    input:
                      content,

                    ...(config.provider ===
                    'openai'
                      ? {
                          model:
                            'omni-moderation-latest',
                        }
                      : {}),
                  },
                ),
            },
          );

        if (!result.ok) {
          throw {
            retry:
              result.status ===
                429 ||
              result.status >=
                500,

            error:
              new Error(
                `Moderation failed with code ${result.status}: ${await result.text()}`,
              ),
          };
        }

        return (
          await result.json()
        ) as {
          results: {
            flagged: boolean;
          }[];
        };
      },
    );

  return flagged;
}

// =====================================================
// RETRIES
// =====================================================

const RETRY_BACKOFF = [
  1000,
  10_000,
  20_000,
];

const RETRY_JITTER =
  100;

type RetryError = {
  retry: boolean;
  error: any;
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
): Promise<{
  retries: number;
  result: T;
  ms: number;
}> {
  let i = 0;

  for (
    ;
    i <=
    RETRY_BACKOFF.length;
    i++
  ) {
    try {
      const start =
        Date.now();

      const result =
        await fn();

      return {
        result,
        retries: i,
        ms:
          Date.now() -
          start,
      };
    } catch (error) {
      const retryError =
        error as RetryError;

      if (
        i <
          RETRY_BACKOFF.length &&
        retryError.retry
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              RETRY_BACKOFF[
                i
              ] +
                RETRY_JITTER *
                  Math.random(),
            ),
        );

        continue;
      }

      if (
        retryError.error
      ) {
        throw retryError.error;
      }

      throw error;
    }
  }

  throw new Error(
    'Unreachable',
  );
}

// =====================================================
// TYPES
// =====================================================

export interface LLMMessage {
  content:
    | string
    | null;

  role:
    | 'system'
    | 'user'
    | 'assistant'
    | 'function';

  name?: string;

  function_call?: {
    name: string;
    arguments: string;
  };
}

interface CreateChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;

  choices: {
    index?: number;

    message?: {
      role:
        | 'system'
        | 'user'
        | 'assistant';

      content:
        string;
    };

    finish_reason?:
      string;
  }[];

  usage?: {
    completion_tokens:
      number;

    prompt_tokens:
      number;

    total_tokens:
      number;
  };
}

interface CreateEmbeddingResponse {
  data: {
    index: number;
    object: string;
    embedding: number[];
  }[];

  model: string;
  object: string;

  usage?: {
    prompt_tokens:
      number;

    total_tokens:
      number;
  };
}

export interface CreateChatCompletionRequest {
  model: string;

  messages:
    LLMMessage[];

  temperature?:
    number | null;

  top_p?:
    number | null;

  n?:
    number | null;

  stream?:
    boolean | null;

  stop?:
    string[] | string;

  max_tokens?:
    number;

  presence_penalty?:
    number | null;

  frequency_penalty?:
    number | null;

  logit_bias?:
    object | null;

  user?: string;

  tools?: {
    type:
      'function';

    function: {
      name: string;
      description?:
        string;
      parameters:
        object;
    };
  }[];

  tool_choice?:
    | 'none'
    | 'auto'
    | {
        type:
          'function';

        function: {
          name:
            string;
        };
      };

  response_format?: {
    type:
      | 'text'
      | 'json_object';
  };
}

// =====================================================
// STREAMING
// =====================================================

const suffixOverlapsPrefix = (
  s1: string,
  s2: string,
) => {
  for (
    let i = 1;
    i <=
    Math.min(
      s1.length,
      s2.length,
    );
    i++
  ) {
    const suffix =
      s1.substring(
        s1.length - i,
      );

    const prefix =
      s2.substring(
        0,
        i,
      );

    if (
      suffix === prefix
    ) {
      return true;
    }
  }

  return false;
};

export class ChatCompletionContent {
  private readonly body:
    ReadableStream<Uint8Array>;

  private readonly stopWords:
    string[];

  constructor(
    body:
      ReadableStream<Uint8Array>,

    stopWords:
      string[],
  ) {
    this.body =
      body;

    this.stopWords =
      stopWords;
  }

  async *readInner() {
    for await (
      const data of
      this.splitStream(
        this.body,
      )
    ) {
      if (
        !data.startsWith(
          'data: ',
        )
      ) {
        continue;
      }

      try {
        const raw =
          data.substring(
            'data: '.length,
          );

        if (
          raw === '[DONE]'
        ) {
          return;
        }

        const json =
          JSON.parse(
            raw,
          ) as {
            choices: {
              delta: {
                content?:
                  string;
              };
            }[];
          };

        const content =
          json.choices?.[0]
            ?.delta
            ?.content;

        if (content) {
          yield content;
        }
      } catch {
        // Ignore malformed
        // stream fragments.
      }
    }
  }

  async *read() {
    let lastFragment =
      '';

    for await (
      const data of
      this.readInner()
    ) {
      lastFragment +=
        data;

      let hasOverlap =
        false;

      for (
        const stopWord of
        this.stopWords
      ) {
        const idx =
          lastFragment.indexOf(
            stopWord,
          );

        if (
          idx >= 0
        ) {
          yield lastFragment.substring(
            0,
            idx,
          );

          return;
        }

        if (
          suffixOverlapsPrefix(
            lastFragment,
            stopWord,
          )
        ) {
          hasOverlap =
            true;
        }
      }

      if (hasOverlap) {
        continue;
      }

      yield lastFragment;

      lastFragment =
        '';
    }

    if (
      lastFragment
    ) {
      yield lastFragment;
    }
  }

  async readAll() {
    let allContent =
      '';

    for await (
      const chunk of
      this.read()
    ) {
      allContent +=
        chunk;
    }

    return allContent;
  }

  async *splitStream(
    stream:
      ReadableStream<Uint8Array>,
  ) {
    const reader =
      stream.getReader();

    let lastFragment =
      '';

    try {
      while (true) {
        const {
          value,
          done,
        } =
          await reader.read();

        if (done) {
          if (
            lastFragment !==
            ''
          ) {
            yield lastFragment;
          }

          break;
        }

        const data =
          new TextDecoder().decode(
            value,
          );

        lastFragment +=
          data;

        const parts =
          lastFragment.split(
            '\n\n',
          );

        for (
          let i = 0;
          i <
          parts.length -
            1;
          i++
        ) {
          yield parts[
            i
          ];
        }

        lastFragment =
          parts[
            parts.length -
              1
          ];
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// =====================================================
// OLLAMA FALLBACK
// =====================================================

export async function tryPullOllama(
  model: string,
  error: string,
) {
  if (
    !error.includes(
      'try pulling',
    )
  ) {
    return;
  }

  const config =
    getLLMConfig();

  const pullResp =
    await fetch(
      config.url +
        '/api/pull',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify(
            {
              name:
                model,
            },
          ),
      },
    );

  console.log(
    'Pull response',
    await pullResp.text(),
  );

  throw {
    retry: true,

    error:
      `Dynamically pulled model. Original error: ${error}`,
  };
}

export async function ollamaFetchEmbedding(
  text: string,
) {
  const config =
    getLLMConfig();

  const {
    result,
  } =
    await retryWithBackoff(
      async () => {
        const resp =
          await fetch(
            config.url +
              '/api/embeddings',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify(
                  {
                    model:
                      config.embeddingModel,

                    prompt:
                      text,
                  },
                ),
            },
          );

        if (
          resp.status ===
          404
        ) {
          const error =
            await resp.text();

          await tryPullOllama(
            config.embeddingModel,
            error,
          );

          throw new Error(
            `Failed to fetch embeddings: ${resp.status}`,
          );
        }

        if (
          !resp.ok
        ) {
          throw new Error(
            `Failed to fetch embeddings: ${resp.status} ${await resp.text()}`,
          );
        }

        const json =
          (
            await resp.json()
          ) as {
            embedding:
              number[];
          };

        return json.embedding;
      },
    );

  return {
    embedding:
      result,
  };
}
