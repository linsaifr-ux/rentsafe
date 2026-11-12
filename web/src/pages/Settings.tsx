import { useState } from "react";
import { api, errorMessage } from "../api.ts";
import { ALL_CITIES } from "../cities.ts";
import type { PageProps } from "../router.tsx";

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
      <h1 className="text-xl font-bold text-gray-900">我的設定</h1>
      <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="city">
        租屋縣市
      </label>
      <select
        id="city"
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-2"
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
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-3 w-full rounded-lg bg-emerald-600 py-2 font-semibold text-white disabled:opacity-50"
      >
        {saving ? "儲存中…" : "儲存"}
      </button>
      {status && <p className="mt-2 text-sm text-gray-600">{status}</p>}
      <p className="mt-6 text-xs text-gray-400">「刪除我的資料」功能準備中。</p>
    </section>
  );
}
