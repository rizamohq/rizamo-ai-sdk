# @rizamo/ai-sdk

[Rizamo](https://rizamo.com) tools for the [Vercel AI SDK](https://ai-sdk.dev): publish, schedule and measure social posts on Instagram, Facebook, TikTok, Threads, LinkedIn and YouTube, and answer comments and messages.

```bash
npm install @rizamo/ai-sdk ai zod
```

```ts
import { generateText, isStepCount } from "ai";
import { createRizamoTools } from "@rizamo/ai-sdk";

const { text } = await generateText({
  model: "anthropic/claude-sonnet-5-5",
  tools: createRizamoTools(), // reads RIZAMO_API_KEY
  stopWhen: isStepCount(10),
  prompt: "List my Instagram accounts, then save a draft for the first one: 'Doors open at 10.'",
});

console.log(text);
```

Create an API key in the Rizamo web app, under **Developers** ([Authentication](https://docs.rizamo.com/authentication#api-keys)). Its scopes decide what the tools may do.

## Tools

| Tool | What it does |
| --- | --- |
| `listProfiles` | The brands or clients the team posts for, with their ids and time zones |
| `listAccounts` | Connected social accounts, with what each can publish |
| `createPost` | A post for one or more accounts: a draft, or scheduled when given a time |
| `getPost` | A post and each target's status, link and error |
| `addMedia` | An image or video from a public URL, for a post |
| `getAnalytics` | Views, reach, engagements and followers over the last days |
| `listThreads` | Comments and messages, newest first |
| `publishPost` | Publishes a post now. Only with `publish: true` |
| `replyToThread` | Replies to a comment or message. Only with `reply: true` |

`publishPost` and `replyToThread` reach the networks at once, so they are off unless you ask for them:

```ts
createRizamoTools({ publish: true, reply: true });
```

When Rizamo refuses a call, the tool returns `{ error, code, status }` with a message that says what to change, so the model can fix its input.

## Options

| Option | Default |
| --- | --- |
| `apiKey` | `RIZAMO_API_KEY` |
| `baseUrl` | `https://api.rizamo.com/v1` |
| `client` | A `RizamoClient` from the [`rizamo`](https://www.npmjs.com/package/rizamo) SDK, configured as you like |
| `publish`, `reply` | `false` |

Rizamo also has a hosted MCP server, which gives an agent every tool without this package: [Vercel AI SDK guide](https://docs.rizamo.com/frameworks/vercel-ai-sdk).

## License

MIT
