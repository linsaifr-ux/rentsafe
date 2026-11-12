import { z } from "zod";
import { ALL_CITIES } from "../cities.js";
import { json, parseBody, type Routes } from "./http.js";

const citySchema = z.object({ city: z.enum(ALL_CITIES).nullable() });

export const meRoutes: Routes = {
  /** 取得（必要時建立）自己的資料 */
  "GET /me": async ({ user, deps }) => {
    const doc = await deps.users.ensure(user.uid, { displayName: user.name });
    return json(200, {
      displayName: doc.displayName || user.name,
      city: doc.city,
      landlordType: doc.landlordType,
      consentAt: doc.consentAt ? doc.consentAt.toDate().toISOString() : null,
    });
  },

  "POST /me/city": async ({ user, body, deps }) => {
    const { city } = parseBody(citySchema, body);
    await deps.users.ensure(user.uid, { displayName: user.name });
    await deps.users.setCity(user.uid, city);
    return json(200, { city });
  },

  "POST /me/consent": async ({ user, deps }) => {
    await deps.users.ensure(user.uid, { displayName: user.name });
    await deps.users.setConsent(user.uid);
    return json(200, { ok: true });
  },
};
