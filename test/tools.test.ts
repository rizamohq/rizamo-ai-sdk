import assert from "node:assert/strict";
import { test } from "node:test";
import { RizamoError, type RizamoClient } from "rizamo";
import { createRizamoTools } from "../src/index.ts";

type Call = { method: string; request: unknown; options: unknown };

function stub(failWith?: Error) {
  const calls: Call[] = [];
  const record = (method: string, answer: unknown) => async (request?: unknown, options?: unknown) => {
    calls.push({ method, request, options });
    if (failWith) throw failWith;
    return answer;
  };
  const client = {
    profiles: { list: record("profiles.list", { items: [{ id: "prof_1" }] }) },
    accounts: { list: record("accounts.list", { data: [{ id: "acc_1" }] }) },
    posts: {
      create: record("posts.create", { id: "post_1", status: "draft" }),
      get: record("posts.get", { id: "post_1" }),
      publish: record("posts.publish", { id: "post_1" }),
    },
    media: { create: record("media.create", { id: "med_1" }) },
    analytics: { overview: record("analytics.overview", { kpis: [] }) },
    inbox: { list: record("inbox.list", { data: [{ id: "thr_1" }] }), reply: record("inbox.reply", { id: "msg_1" }) },
  } as unknown as RizamoClient;
  return { client, calls };
}

const run = (tools: ReturnType<typeof createRizamoTools>, name: string, input: unknown) =>
  tools[name]!.execute!(input as never, { toolCallId: "t1", messages: [], context: {} } as never);

test("publishing and replies are off unless asked for", () => {
  const { client } = stub();
  assert.deepEqual(Object.keys(createRizamoTools({ client })).sort(), [
    "addMedia",
    "createPost",
    "getAnalytics",
    "getPost",
    "listAccounts",
    "listProfiles",
    "listThreads",
  ]);
  const all = Object.keys(createRizamoTools({ client, publish: true, reply: true }));
  assert.ok(all.includes("publishPost") && all.includes("replyToThread"));
});

test("createPost saves a draft without a time, with its own idempotency key", async () => {
  const { client, calls } = stub();
  const tools = createRizamoTools({ client });
  await run(tools, "createPost", { profileId: "prof_1", text: "Hello", accountIds: ["acc_1", "acc_2"] });
  await run(tools, "createPost", { profileId: "prof_1", text: "Again", accountIds: ["acc_1"] });
  assert.deepEqual(calls[0]!.request, {
    profileId: "prof_1",
    text: "Hello",
    targets: [{ accountId: "acc_1" }, { accountId: "acc_2" }],
    status: "draft",
  });
  const keys = calls.map((c) => (c.options as { idempotencyKey: string }).idempotencyKey);
  assert.ok(keys[0] && keys[1] && keys[0] !== keys[1]);
});

test("createPost schedules with a time and media", async () => {
  const { client, calls } = stub();
  await run(createRizamoTools({ client }), "createPost", {
    profileId: "prof_1",
    text: "Hi",
    accountIds: ["acc_1"],
    scheduledAt: "2026-12-01T09:00:00Z",
    mediaIds: ["med_1"],
  });
  assert.deepEqual(calls[0]!.request, {
    profileId: "prof_1",
    text: "Hi",
    targets: [{ accountId: "acc_1" }],
    status: "scheduled",
    scheduledAt: "2026-12-01T09:00:00Z",
    mediaIds: ["med_1"],
  });
});

test("lists answer with the first page's items", async () => {
  const { client } = stub();
  const tools = createRizamoTools({ client });
  assert.deepEqual(await run(tools, "listProfiles", {}), { items: [{ id: "prof_1" }] });
  assert.deepEqual(await run(tools, "listAccounts", {}), { items: [{ id: "acc_1" }] });
  assert.deepEqual(await run(tools, "listThreads", { status: "open" }), { items: [{ id: "thr_1" }] });
});

test("each tool calls the SDK method it names", async () => {
  const { client, calls } = stub();
  const tools = createRizamoTools({ client, publish: true, reply: true });
  await run(tools, "getPost", { postId: "post_1" });
  await run(tools, "addMedia", { url: "https://example.com/a.jpg", profileId: "prof_1" });
  await run(tools, "getAnalytics", { days: 7, profileId: "prof_1" });
  await run(tools, "publishPost", { postId: "post_1" });
  await run(tools, "replyToThread", { threadId: "thr_1", text: "Thanks!" });
  assert.deepEqual(
    calls.map((c) => [c.method, c.request]),
    [
      ["posts.get", { id: "post_1" }],
      ["media.create", { url: "https://example.com/a.jpg", profileId: "prof_1" }],
      ["analytics.overview", { days: 7, profileId: "prof_1" }],
      ["posts.publish", { id: "post_1" }],
      ["inbox.reply", { id: "thr_1", text: "Thanks!" }],
    ],
  );
});

test("Rizamo's errors go back to the model", async () => {
  const refused = new RizamoError({
    message: "Bad Request",
    statusCode: 400,
    body: { error: { code: "invalid_request", message: "Account acc_x is not in this post's profile." } },
  });
  const { client } = stub(refused);
  assert.deepEqual(
    await run(createRizamoTools({ client }), "createPost", { profileId: "p", text: "x", accountIds: ["acc_x"] }),
    { error: "Account acc_x is not in this post's profile.", code: "invalid_request", status: 400 },
  );
});

test("other errors are thrown, for the AI SDK to report", async () => {
  const { client } = stub(new TypeError("boom"));
  await assert.rejects(() => run(createRizamoTools({ client }), "listProfiles", {}) as Promise<unknown>, TypeError);
});
