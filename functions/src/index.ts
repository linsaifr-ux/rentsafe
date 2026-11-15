import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { MODELS, REGION } from "./config.js";
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
import { firestoreViewingRepo } from "./viewing/repo.js";
import { firestoreLeaseCheckRepo } from "./lease/repo.js";
import { firestoreDownloadTokenRepo, firestoreEvidenceRepo } from "./evidence/repo.js";
import { saveFromLine, setCategoryFromLine } from "./evidence/save.js";
import { firebaseBlobStore } from "./evidence/store.js";
import { firestoreCaseRepo } from "./cases/repo.js";

initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 10 });

/** LIFF 呼叫的 HTTPS API（Hosting 將 /api/** 轉到這裡） */
// 租約健檢要讀照片：Gemini 金鑰、較長逾時、較大記憶體（照片只在記憶體，不落地）
export const api = onRequest({ cors: false, secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: "1GiB" }, async (req, res) => {
  const db = getFirestore();
  try {
    const out = await handleApi(
      { method: req.method, path: req.path, headers: req.headers, body: req.body },
      {
        verify: (token) => verifyIdToken(token, LINE_LOGIN_CHANNEL_ID.value()),
        users: firestoreUserRepo(db),
        limiter: firestoreRateLimiter(db),
        kb: firestoreKbIndex(db),
        viewings: firestoreViewingRepo(db),
        lease: { llm: geminiLlm(GEMINI_API_KEY.value(), MODELS.vision), repo: firestoreLeaseCheckRepo(db) },
        evidence: { repo: firestoreEvidenceRepo(db), store: firebaseBlobStore(getStorage().bucket()), tokens: firestoreDownloadTokenRepo(db) },
        cases: { repo: firestoreCaseRepo(db), tokens: firestoreDownloadTokenRepo(db, "caseExports"), qa: firestoreQaLog(db) },
        log: (msg, data) => logger.error(msg, data),
      },
    );
    if (out.raw) {
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      if (out.raw.filename) res.set("Content-Disposition", `attachment; filename="${out.raw.filename}"`);
      res.status(out.status).type(out.raw.contentType).send(out.raw.data);
      return;
    }
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
        saveEvidence: (input) =>
          saveFromLine(input, {
            repo: firestoreEvidenceRepo(db),
            store: firebaseBlobStore(getStorage().bucket()),
            line: createLineClient(LINE_CHANNEL_ACCESS_TOKEN.value()),
            limiter,
            liffId,
          }),
        setEvidenceCategory: (input) => setCategoryFromLine(input, { repo: firestoreEvidenceRepo(db) }),
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
