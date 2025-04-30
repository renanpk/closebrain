import {
  streamText,
  type CoreMessage,
  type LanguageModelV1,
  type StreamTextResult,
  type ToolSet,
} from "ai";
import { task } from "../task";
import {
  LogLevel,
  type Action,
  type ActionCallContext,
  type AnyAction,
  type AnyAgent,
  type AnyContext,
  type WorkingMemory,
} from "../types";
import { Logger } from "../logger";
import { wrapStream } from "../streaming";
import { modelsResponseConfig, reasoningModels } from "../configs";

/**
 * Prepares a stream response by handling the stream result and parsing it.
 *
 * @param options - Configuration options
 * @param options.contextId - The ID of the context
 * @param options.step - The current step in the process
 * @param options.stream - The stream result to process
 * @param options.logger - The logger instance
 * @param options.task - The task context containing callId and debug function
 * @returns An object containing the parsed response promise and wrapped text stream
 */
function prepareStreamResponse({
  model,
  stream,
  isReasoningModel,
  logger,
}: {
  model: LanguageModelV1;
  stream: StreamTextResult<ToolSet, never>;
  isReasoningModel: boolean;
  logger: Logger;
}) {
  const prefix =
    modelsResponseConfig[model.modelId]?.prefix ??
    (isReasoningModel
      ? modelsResponseConfig[model.modelId]?.thinkTag ?? "<think>"
      : "<response>");
  const suffix = "</response>";
  return {
    getTextResponse: async () => {
      const rawTextResult = await stream.text; // <-- AQUI ESTÁ O TEXTO BRUTO

      // ---------> ADICIONE O DEBUG LOG AQUI <---------
      if (logger) {
        logger.debug(
          "prepareStreamResponse:raw_llm_response",
          "Raw LLM Text:",
          rawTextResult
        );
      } else {
        // Fallback para console.log
        console.log("--- RAW LLM RESPONSE START ---");
        console.log(rawTextResult);
        console.log("--- RAW LLM RESPONSE END ---");
      }
      // ----------------------------------------------
      const result = await stream.text;
      const text = prefix + result + suffix;
      return text;
    },
    stream: wrapStream(stream.textStream, prefix, suffix),
  };
}

type GenerateOptions = {
  prompt: string;
  workingMemory: WorkingMemory;
  logger: Logger;
  model: LanguageModelV1;
  onError: (error: unknown) => void;
};

export const runGenerate = task({
  key: "agent:run:generate",
  handler: async (
    { prompt, workingMemory, model, onError }: GenerateOptions,
    { abortSignal }
  ) => {
    const isReasoningModel = reasoningModels.includes(model.modelId);
    const messages: CoreMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
        ],
      },
    ];
    if (modelsResponseConfig[model.modelId]?.assist !== false)
      messages.push({
        role: "assistant",
        content: isReasoningModel
          ? modelsResponseConfig[model.modelId]?.thinkTag ?? "<think>"
          : "<response>",
      });

    if (workingMemory.currentImage) {
      messages[0].content = [
        ...messages[0].content,
        {
          type: "image",
          image: workingMemory.currentImage,
        },
      ] as CoreMessage["content"];
    }

    const stream = streamText({
      model,
      messages,
      stopSequences: ["\n</response>"],
      temperature: 0.6,
      abortSignal,
      onError: (event) => {
        onError(event.error);
      },
    });

    return prepareStreamResponse({
      model,
      stream,
      isReasoningModel,
      logger: new Logger({
        level: LogLevel.DEBUG,
      }),
    });
  },
});

/**
 * Task that executes an action with the given context and parameters.
 *
 * @param options - Configuration options
 * @param options.ctx - The agent context with memory
 * @param options.action - The action to execute
 * @param options.call - The action call details
 * @param options.agent - The agent instance
 * @param options.logger - The logger instance
 * @returns The result of the action execution
 * @throws Will throw an error if the action execution fails
 */
export const runAction = task({
  key: "agent:run:action",
  handler: async <TContext extends AnyContext>({
    ctx,
    action,
    agent,
    logger,
  }: {
    ctx: ActionCallContext<any, TContext>;
    action: AnyAction;
    agent: AnyAgent;
    logger: Logger;
  }) => {
    logger.info(
      "agent:action_call:" + ctx.call.id,
      ctx.call.name,
      JSON.stringify(ctx.call.data)
    );

    try {
      const result =
        action.schema === undefined
          ? await Promise.try((action as Action<undefined>).handler, ctx, agent)
          : await Promise.try(action.handler as any, ctx.call.data, ctx, agent);

      logger.debug("agent:action_result:" + ctx.call.id, ctx.call.name, result);

      return result;
    } catch (error) {
      logger.error("agent:action", "ACTION_FAILED", { error });

      if (action.onError) {
        return await Promise.try(action.onError, error, ctx, agent);
      } else {
        throw error;
      }
    }
  },
});
