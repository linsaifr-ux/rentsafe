/**
 * 緊急狀況偵測（SPEC 5.1 第一步）。純規則、不呼叫模型，確保快且可預期。
 * 偵測到時回固定訊息：先撥 119／110、確保安全，附「出事了」急救包按鈕。
 *
 * 原則：寧可誤判為緊急（多提醒一次安全），也不要漏掉正在發生的危險。
 * 但「上個月失火」這種已經過去的事件不算緊急，交給一般問答。
 */

export type EmergencyKind = "fire" | "injury" | "threat" | "locked_out";

export interface SafetyResult {
  emergency: boolean;
  kind: EmergencyKind | null;
}

const NOW = /(現在|正在|剛剛|剛才|目前|還在|快要|一直|好多|很多|救命|怎麼辦[!！]*$)/;
const PAST = /(上個?月|上週|上禮拜|去年|前幾天|幾天前|之前|以前|那時候|當時|已經滅|撲滅|燒完|事後|後來)/;

const RULES: Array<{ kind: EmergencyKind; re: RegExp; needsNow: boolean }> = [
  // 明確求救：一律視為緊急
  { kind: "fire", re: /(救命.*(火|煙))|((火|煙).*救命)|(燒起來了)|(火燒(房|屋|厝))|(火災了)/, needsNow: false },
  { kind: "injury", re: /救命|(快要?死了)|(不能呼吸)|(喘不過氣)/, needsNow: false },
  { kind: "threat", re: /(拿(刀|棍|球棒))|(要殺)|(要打我)|(闖進(來|我))|(被打了?)/, needsNow: false },
  // 需要「正在發生」的字眼
  { kind: "fire", re: /(著火|起火|失火|冒煙|濃煙|火災|有煙|燒焦味|瓦斯味|瓦斯外洩|漏瓦斯)/, needsNow: true },
  { kind: "injury", re: /(受傷|流血|昏倒|暈倒|骨折|一氧化碳|中毒|觸電|電到)/, needsNow: true },
  { kind: "threat", re: /(威脅|恐嚇|跟蹤|騷擾|堵我|在門口不走|要動手)/, needsNow: true },
  { kind: "locked_out", re: /(鎖在(門)?外|被鎖住|進不去|換(了)?鎖|把我(的)?東西丟出)/, needsNow: true },
];

/** 一般法律問題的線索：有這些字眼又沒有「正在發生」的時間詞時，不當成緊急 */
const QUESTION = /(之後|後來|賠|責任|押金|租金|契約|租約|可以|嗎|怎麼算|規定|房東要|違約)/;

export function detectEmergency(text: string): SafetyResult {
  const t = text.replace(/\s+/g, "");
  const now = NOW.test(t);
  const past = PAST.test(t);
  for (const r of RULES) {
    if (!r.re.test(t)) continue;
    if (!r.needsNow || now) return { emergency: true, kind: r.kind };
    if (past) continue; // 已經過去的事件
    // 沒有時間線索：被鎖在外面需要明確的「現在」；其他情況除非看起來是一般法律問題，否則當成緊急
    if (r.kind === "locked_out") continue;
    if (QUESTION.test(t)) continue;
    return { emergency: true, kind: r.kind };
  }
  return { emergency: false, kind: null };
}

export const EMERGENCY_TEXT: Record<EmergencyKind, string> = {
  fire: "如果現在有火或濃煙：\n1. 立刻離開，低姿勢沿逃生路線往下或往外逃，不要搭電梯。\n2. 到安全的地方撥 119。\n3. 不要回去拿東西。",
  injury: "如果有人受傷或身體不舒服：\n1. 立刻撥 119。\n2. 懷疑一氧化碳或瓦斯外洩：先打開門窗、離開現場，不要開關電器。",
  threat: "如果你正受到威脅或人身危險：\n1. 先離開現場到安全、人多的地方。\n2. 立刻撥 110 報警。\n3. 安全之後再保存對話、錄音等紀錄。",
  locked_out: "如果你現在被鎖在門外或東西被丟出：\n1. 先確保自己今晚有安全的地方待。\n2. 可以撥 110 請警察到場協助、做紀錄。\n3. 拍照錄影保存現場狀況。",
};

export const EMERGENCY_FOOTER = "安全之後，可以點下方「出事了」，一步步處理後續。如果你沒有立即危險，只是想了解規定，請換個方式再問一次。";
