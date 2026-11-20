import { tool, type ToolSet } from "ai";
import { RizamoClient, RizamoError } from "rizamo";
import { z } from "zod";

export type RizamoToolsOptions = {
  /** Defaults to the RIZAMO_API_KEY environment variable. Its scopes decide what each tool may do. */
  apiKey?: string;
  /** Defaults to https://api.rizamo.com/v1. */
  baseUrl?: string;
  /** Your own client, configured as you like. Takes the place of `apiKey` and `baseUrl`. */
  client?: RizamoClient;
  /** Add `publishPost`, which publishes a post now. Off by default: it reaches the networks at once. */
  publish?: boolean;
  /** Add `replyToThread`, which answers a comment or message on its network. Off by default. */
  reply?: boolean;
};

/** What a tool returns when Rizamo refuses a call: its message says what to change. */
export type RizamoToolError = { error: string; code?: string; status?: number };

async function call<T>(run: () => Promise<T>): Promise<T | RizamoToolError> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RizamoError) {
      const body = error.body as { error?: { code?: string; message?: string } } | undefined;
      return { error: body?.error?.message ?? error.message, code: body?.error?.code, status: error.statusCode };
    }
    throw error;
  }
}

const profileId = z.string().describe("A profile's id, from listProfiles.");

/**
 * Rizamo's tools for the AI SDK: profiles, accounts, posts (drafts, or scheduled with a time), media, analytics and the
 * inbox. `publishPost` and `replyToThread` reach the networks at once, so they are added only when asked for.
 */
export function createRizamoTools(options: RizamoToolsOptions = {}): ToolSet {
  const rizamo = options.client ?? new RizamoClient({ apiKey: options.apiKey, baseUrl: options.baseUrl });
  const once = () => ({ idempotencyKey: crypto.randomUUID() });

  const tools: ToolSet = {
    listProfiles: tool({
      description: "List the profiles (brands or clients) the team posts for, each with its id and time zone.",
      inputSchema: z.object({}),
      execute: () => call(async () => ({ items: (await rizamo.profiles.list()).items })),
    }),
    listAccounts: tool({
      description: "List the connected social accounts, with their ids, networks, handles and what each can publish.",
      inputSchema: z.object({ profileId: profileId.optional() }),
      execute: ({ profileId }) => call(async () => ({ items: (await rizamo.accounts.list({ profileId })).data })),
    }),
    createPost: tool({
      description:
        "Create a post for one or more accounts of a profile. Without scheduledAt it is saved as a draft, which never goes out.",
      inputSchema: z.object({
        profileId,
        text: z.string().describe("The post's text."),
        accountIds: z.array(z.string()).min(1).describe("The accounts to post to, from listAccounts."),
        scheduledAt: z.string().optional().describe("ISO 8601 date and time to publish at, such as 2026-12-01T09:00:00Z."),
        mediaIds: z.array(z.string()).optional().describe("Images or videos from addMedia."),
      }),
      execute: ({ profileId, text, accountIds, scheduledAt, mediaIds }) =>
        call(() =>
          rizamo.posts.create(
            {
              profileId,
              text,
              targets: accountIds.map((accountId) => ({ accountId })),
              status: scheduledAt ? "scheduled" : "draft",
              ...(scheduledAt ? { scheduledAt } : {}),
              ...(mediaIds?.length ? { mediaIds } : {}),
            },
            once(),
          ),
        ),
    }),
    getPost: tool({
      description: "Get a post and each target's status, link and error.",
      inputSchema: z.object({ postId: z.string() }),
      execute: ({ postId }) => call(() => rizamo.posts.get({ id: postId })),
    }),
    addMedia: tool({
      description: "Add an image or video for a post from a public URL. Its id goes in createPost's mediaIds.",
      inputSchema: z.object({
        url: z.string().url().describe("A public http or https address of the file."),
        profileId: profileId.optional(),
      }),
      execute: ({ url, profileId }) => call(() => rizamo.media.create({ url, ...(profileId ? { profileId } : {}) }, once())),
    }),
    getAnalytics: tool({
      description: "Views, reach, engagements and followers over the last days, against the period before, with the top posts.",
      inputSchema: z.object({ days: z.number().int().min(1).max(365).default(28), profileId: profileId.optional() }),
      execute: ({ days, profileId }) => call(() => rizamo.analytics.overview({ days, profileId })),
    }),
    listThreads: tool({
      description: "List comments and messages, newest first: open for what still needs an answer, or done.",
      inputSchema: z.object({ status: z.enum(["open", "done"]).default("open"), profileId: profileId.optional() }),
      execute: ({ status, profileId }) => call(async () => ({ items: (await rizamo.inbox.list({ status, profileId })).data })),
    }),
  };

  if (options.publish) {
    tools.publishPost = tool({
      description: "Publish a post now, on every target that is not live yet.",
      inputSchema: z.object({ postId: z.string() }),
      execute: ({ postId }) => call(() => rizamo.posts.publish({ id: postId }, once())),
    });
  }
  if (options.reply) {
    tools.replyToThread = tool({
      description: "Reply to a comment or message on its network.",
      inputSchema: z.object({ threadId: z.string().describe("From listThreads."), text: z.string() }),
      execute: ({ threadId, text }) => call(() => rizamo.inbox.reply({ id: threadId, text }, once())),
    });
  }
  return tools;
}
