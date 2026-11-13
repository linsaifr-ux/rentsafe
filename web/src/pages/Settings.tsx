import { useState } from "react";
import { Check, MapPin, ShieldCheck, Trash2 } from "lucide-react";
import { api, errorMessage } from "../api.ts";
import { ALL_CITIES } from "../cities.ts";
import type { PageProps } from "../router.tsx";
import { Button, Card, ErrorText, IconBadge, NavCard, PageHeader } from "../components/ui.tsx";
import { FIELD, FIELD_LABEL } from "./ViewingCheck.tsx";

export function Settings({ me, onMeChange }: PageProps) {
  const [city, setCity] = useState<string>(me.city ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.setCity(city || null);
      onMeChange({ ...me, city: res.city });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="animate-enter">
      <PageHeader title="我的設定" />
      <Card>
        <div className="flex items-center gap-3">
          <IconBadge icon={MapPin} tone="emerald" />
          <div>
            <label className={FIELD_LABEL} htmlFor="city">
              租屋縣市
            </label>
            <p className="text-xs text-slate-500">用來找你所在縣市的消防自治條例</p>
          </div>
        </div>
        <select
          id="city"
          className={`${FIELD} mt-3`}
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            setSaved(false);
          }}
        >
          <option value="">其他／不設定</option>
          {ALL_CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button className="mt-4" onClick={save} disabled={saving} icon={saved ? Check : undefined}>
          {saving ? "儲存中…" : saved ? "已儲存" : "儲存"}
        </Button>
        {error && <ErrorText>{error}</ErrorText>}
      </Card>

      <div className="mt-3 space-y-3">
        <NavCard href="/privacy" icon={ShieldCheck} tone="sky" title="隱私權政策" desc="我們蒐集什麼、怎麼使用" />
        <div className="flex min-h-16 items-center gap-3 rounded-3xl bg-white p-4 opacity-60 shadow-card" aria-disabled="true">
          <IconBadge icon={Trash2} tone="red" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-slate-900">刪除我的資料</span>
            <span className="block text-sm text-slate-500">功能準備中</span>
          </span>
        </div>
      </div>
    </section>
  );
}
