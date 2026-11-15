/** Postback data 的編碼與解析，格式：action=xxx&key=value */
export type PostbackAction =
  | { action: "setCity"; city: string | null }
  | { action: "askLaw" }
  /** 存證卡片的「改分類」 */
  | { action: "evCat"; id: string; category: string }
  | { action: "unknown" };

export function encodePostback(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

export function parsePostback(data: string): PostbackAction {
  const p = new URLSearchParams(data);
  switch (p.get("action")) {
    case "setCity": {
      const city = p.get("city");
      return { action: "setCity", city: city ? city : null };
    }
    case "askLaw":
      return { action: "askLaw" };
    case "evCat": {
      const id = p.get("id");
      const category = p.get("cat");
      return id && category ? { action: "evCat", id, category } : { action: "unknown" };
    }
    default:
      return { action: "unknown" };
  }
}
