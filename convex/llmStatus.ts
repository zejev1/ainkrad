import { query } from './_generated/server';

export const getLlmStatus = query({
  args: {},

  handler: async () => {
    const provider =
      process.env.LLM_PROVIDER ??
      (
        process.env.OPENAI_API_KEY
          ? 'openai'
          : process.env.TOGETHER_API_KEY
            ? 'together'
            : process.env.LLM_API_URL
              ? 'custom'
              : 'ollama'
      );

    return {
      provider,

      hasOpenAIKey:
        !!process.env.OPENAI_API_KEY,

      hasTogetherKey:
        !!process.env.TOGETHER_API_KEY,

      hasCustomUrl:
        !!process.env.LLM_API_URL,

      hasCustomKey:
        !!process.env.LLM_API_KEY,

      ollamaHost:
        process.env.OLLAMA_HOST ??
        'http://127.0.0.1:11434',

      openAiModel:
        process.env.OPENAI_CHAT_MODEL ??
        'gpt-4o-mini',

      customModel:
        process.env.LLM_MODEL ??
        null,

      ollamaModel:
        process.env.OLLAMA_MODEL ??
        'llama3',
    };
  },
});
