import { z } from "zod";

/** LINE webhook 事件（只定義本專案用到的欄位，其他欄位保留不驗證） */
const source = z.object({ type: z.string(), userId: z.string().optional() }).loose();

const base = {
  timestamp: z.number(),
  source,
  webhookEventId: z.string().optional(),
  replyToken: z.string().optional(),
};

export const lineEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("follow") }).loose(),
  z.object({ ...base, type: z.literal("unfollow") }).loose(),
  z.object({
    ...base,
    type: z.literal("postback"),
    postback: z.object({ data: z.string() }).loose(),
  }).loose(),
  z.object({
    ...base,
    type: z.literal("message"),
    message: z
      .object({
        id: z.string(),
        type: z.string(),
        text: z.string().optional(),
        fileName: z.string().optional(),
      })
      .loose(),
  }).loose(),
]);

export type LineEvent = z.infer<typeof lineEventSchema>;

export const webhookBodySchema = z.object({
  destination: z.string().optional(),
  events: z.array(z.unknown()),
});

/** 解析 webhook body；不認得的事件類型直接略過 */
export function parseEvents(body: unknown): LineEvent[] {
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) return [];
  const out: LineEvent[] = [];
  for (const raw of parsed.data.events) {
    const ev = lineEventSchema.safeParse(raw);
    if (ev.success) out.push(ev.data);
  }
  return out;
}

/** 送給 LINE 的訊息物件（Messaging API message object） */
export type LineMessage = Record<string, unknown> & { type: string };
