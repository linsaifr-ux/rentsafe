import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { ALL_CITIES } from "../cities.ts";
import type { PageProps } from "../router.tsx";
import { Button } from "../components/ui.tsx";
import { FIELD, FIELD_LABEL } from "./ViewingCheck.tsx";

export function Settings({ me, onMeChange }: PageProps) {
  const [city, setCity] = useState<string>(me.city ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await api.setCity(city || null);
      onMeChange({ ...me, city: res.city });
      setStatus("已儲存");
    } catch (err) {
      setStatus(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">我的設定</h1>
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <label className={FIELD_LABEL} htmlFor="city">
        租屋縣市
      </label>
      <select
        id="city"
        className={FIELD}
        value={city}
        onChange={(e) => setCity(e.target.value)}
      >
        <option value="">其他／不設定</option>
        {ALL_CITIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <Button className="mt-4" onClick={save} disabled={saving}>
        {saving ? "儲存中…" : "儲存"}
      </Button>
      {status && <p className="mt-2 text-center text-sm text-gray-600">{status}</p>}
      </div>
      <p className="mt-6 text-xs text-gray-400">「刪除我的資料」功能準備中。</p>
    </section>
  );
}
