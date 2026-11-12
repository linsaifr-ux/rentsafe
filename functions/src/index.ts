import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { REGION } from "./config.js";
import { geminiEmbedder } from "./ai/embed.js";
import { geminiLlm } from "./ai/llm.js";
import { answerQuestion } from "./ai/orchestrator.js";
import { firestoreQaLog } from "./ai/qaLog.js";
import { firestoreKbIndex } from "./ai/retrieve.js";
import { verifyIdToken } from "./api/auth.js";
import { handleApi } from "./api/router.js";
import { answerMessages } from "./line/answerFlex.js";
import { createLineClient } from "./line/client.js";
import { processWebhook } from "./line/webhook.js";
import { firestoreRateLimiter } from "./rateLimit.js";
import {
  GEMINI_API_KEY,
  LIFF_ID,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LINE_LOGIN_CHANNEL_ID,
} from "./secrets.js";
import { firestoreUserRepo } from "./users.js";

initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 10 });

/** LIFF 呼叫的 HTTPS API（Hosting 將 /api/** 轉到這裡） */
export const api = onRequest({ cors: false }, async (req, res) => {
  const db = getFirestore();
  try {
    const out = await handleApi(
      { method: req.method, path: req.path, headers: req.headers, body: req.body },
      {
        verify: (token) => verifyIdToken(token, LINE_LOGIN_CHANNEL_ID.value()),
        users: firestoreUserRepo(db),
        limiter: firestoreRateLimiter(db),
      },
    );
    res.status(out.status).json(out.body);
  } catch (err) {
    logger.error("api error", { path: req.path, err: String(err) });
    res.status(500).json({ error: "internal" });
  }
});

/** LINE Messaging API webhook */
export const lineWebhook = onRequest(
  { secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, GEMINI_API_KEY], timeoutSeconds: 60, memory: "512MiB" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }
    const db = getFirestore();
    const liffId = LIFF_ID.value();
    const limiter = firestoreRateLimiter(db);
    const status = await processWebhook(
      { rawBody: req.rawBody, signature: req.get("x-line-signature"), body: req.body },
      LINE_CHANNEL_SECRET.value(),
      {
        line: createLineClient(LINE_CHANNEL_ACCESS_TOKEN.value()),
        users: firestoreUserRepo(db),
        liffId,
        log: (msg, data) => logger.error(msg, data),
        answerQuestion: async (input) => {
          const { result } = await answerQuestion(input, {
            llm: geminiLlm(GEMINI_API_KEY.value()),
            embedder: geminiEmbedder(GEMINI_API_KEY.value()),
            index: firestoreKbIndex(db),
            limiter,
            qaLog: firestoreQaLog(db),
          });
          return answerMessages(result, liffId);
        },
      },
    );
    if (status !== 200) logger.warn("webhook rejected", { status });
    res.status(status).end();
  },
);
