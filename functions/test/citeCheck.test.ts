import { describe, expect, it } from "vitest";
import {
  chineseToNumber,
  citeCheck,
  findArticleRefs,
  stripSpaces,
  stripUnverified,
  UNVERIFIED_NOTE,
  type AnswerForCheck,
  type SourceArticle,
} from "../src/ai/citeCheck.js";

// 條文內容取自 kb/laws（全國法規資料庫官方資料）
const SOURCES: SourceArticle[] = [
  {
    lawName: "民法",
    articleNo: "424",
    text: "租賃物為房屋或其他供居住之處所者，如有瑕疵，危及承租人或其同居人之安全或健康時，承租人雖於訂約時已知其瑕疵，或已拋棄其終止契約之權利，仍得終止契約。",
  },
  {
    lawName: "民法",
    articleNo: "429",
    text: "租賃物之修繕，除契約另有訂定或另有習慣外，由出租人負擔。\n出租人為保存租賃物所為之必要行為，承租人不得拒絕。",
  },
  { lawName: "租賃住宅市場發展及管理條例", articleNo: "7", text: "押金之金額，不得逾二個月之租金總額。" },
  { lawName: "民法", articleNo: "463-1", text: "本節規定，於權利之租賃準用之。" },
];

const ok = (over: Partial<AnswerForCheck> = {}): AnswerForCheck => ({
  summary: "房子危險到影響安全時，就算簽約時知道，依民法第 424 條仍可以終止租約。",
  citations: [{ lawName: "民法", articleNo: "424", quote: "承租人雖於訂約時已知其瑕疵，或已拋棄其終止契約之權利，仍得終止契約" }],
  actions: ["拍照記錄危險狀況", "以存證信函通知房東終止契約"],
  ...over,
});

describe("citeCheck 規則 1：citation 必須在檢索結果中", () => {
  it("全部正確時通過", () => {
    const r = citeCheck(ok(), SOURCES);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
  });

  it("條號不在檢索結果 → 失敗", () => {
    const r = citeCheck(ok({ summary: "見第 425 條。", citations: [{ lawName: "民法", articleNo: "425", quote: "租賃契約" }] }), SOURCES);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ type: "not_retrieved", index: 0 });
    expect(r.invalidIndexes).toEqual([0]);
  });

  it("法規名稱不同（同條號）→ 失敗", () => {
    const r = citeCheck(ok({ citations: [{ lawName: "消防法", articleNo: "424", quote: "仍得終止契約" }] }), SOURCES);
    expect(r.errors.map((e) => e.type)).toContain("not_retrieved");
  });

  it("條號各種寫法都能對應：第 424 條、第424條、４２４", () => {
    for (const articleNo of ["第 424 條", "第424條", "４２４", "424"]) {
      const r = citeCheck(ok({ citations: [{ lawName: "民法", articleNo, quote: "仍得終止契約" }] }), SOURCES);
      expect(r.ok, articleNo).toBe(true);
    }
  });

  it("之X 條號：463-1 與 第463條之1 等價", () => {
    const r = citeCheck(
      {
        summary: "依第 463-1 條準用。",
        citations: [{ lawName: "民法", articleNo: "第463條之1", quote: "於權利之租賃準用之" }],
        actions: [],
      },
      SOURCES,
    );
    expect(r.ok).toBe(true);
    expect(r.valid[0]?.articleNo).toBe("463-1");
  });

  it("法規名稱中的空白不影響比對", () => {
    const r = citeCheck(ok({ citations: [{ lawName: " 民 法 ", articleNo: "424", quote: "仍得終止契約" }] }), SOURCES);
    expect(r.ok).toBe(true);
    expect(r.valid[0]?.lawName).toBe("民法"); // 回傳正式名稱
  });

  it("無法解析的條號 → 失敗", () => {
    const r = citeCheck(ok({ summary: "說明", citations: [{ lawName: "民法", articleNo: "某條", quote: "仍得終止契約" }] }), SOURCES);
    expect(r.errors[0]?.type).toBe("not_retrieved");
  });
});

describe("citeCheck 規則 2：quote 必須逐字出自條文", () => {
  it("quote 有全形、半形空白或換行仍可通過", () => {
    const r = citeCheck(
      ok({ citations: [{ lawName: "民法", articleNo: "424", quote: "承租人雖於訂約時　已知其瑕疵， 或已拋棄\n其終止契約之權利" }] }),
      SOURCES,
    );
    expect(r.ok).toBe(true);
  });

  it("跨條文換行的 quote 可通過（條文本身含換行）", () => {
    const r = citeCheck(
      {
        summary: "修繕原則上由房東負責。",
        citations: [{ lawName: "民法", articleNo: "429", quote: "由出租人負擔。出租人為保存租賃物所為之必要行為" }],
        actions: [],
      },
      SOURCES,
    );
    expect(r.ok).toBe(true);
  });

  it("改寫過的 quote → 失敗", () => {
    const r = citeCheck(ok({ citations: [{ lawName: "民法", articleNo: "424", quote: "房客即使簽約時知道也可以解約" }] }), SOURCES);
    expect(r.errors[0]).toMatchObject({ type: "quote_mismatch" });
  });

  it("差一個字也失敗", () => {
    const r = citeCheck(ok({ citations: [{ lawName: "民法", articleNo: "424", quote: "仍可終止契約" }] }), SOURCES);
    expect(r.errors[0]?.type).toBe("quote_mismatch");
  });

  it("quote 引到另一條的文字 → 失敗", () => {
    const r = citeCheck(ok({ citations: [{ lawName: "民法", articleNo: "424", quote: "由出租人負擔" }] }), SOURCES);
    expect(r.errors[0]?.type).toBe("quote_mismatch");
  });

  it("空白 quote → 失敗", () => {
    for (const quote of ["", "   ", "　\n"]) {
      const r = citeCheck(ok({ citations: [{ lawName: "民法", articleNo: "424", quote }] }), SOURCES);
      expect(r.errors[0]?.type).toBe("empty_quote");
    }
  });

  it("標點不同視為不同（不做模糊比對）", () => {
    const r = citeCheck(ok({ citations: [{ lawName: "民法", articleNo: "424", quote: "如有瑕疵,危及承租人" }] }), SOURCES);
    expect(r.errors[0]?.type).toBe("quote_mismatch");
  });
});

describe("citeCheck 規則 3：summary／actions 的「第 X 條」要對應到 citations", () => {
  it("summary 提到沒引用的條號 → 失敗", () => {
    const r = citeCheck(ok({ summary: "依民法第 424 條與第 430 條，你可以終止契約。" }), SOURCES);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([{ type: "unbacked_reference", field: "summary", ref: "第 430 條", articleNo: "430" }]);
  });

  it("actions 提到沒引用的條號 → 失敗", () => {
    const r = citeCheck(ok({ actions: ["依第429條要求房東修繕"] }), SOURCES);
    expect(r.errors).toEqual([{ type: "unbacked_reference", field: "actions", ref: "第429條", articleNo: "429" }]);
  });

  it("全形數字、之X、-X 寫法都會被檢查", () => {
    expect(findArticleRefs("第４２４條、第 6之1 條、第463-1條")).toEqual([
      { ref: "第４２４條", articleNo: "424" },
      { ref: "第 6之1 條", articleNo: "6-1" },
      { ref: "第463-1條", articleNo: "463-1" },
    ]);
  });

  it("國字條號也會被檢查，不能繞過", () => {
    expect(findArticleRefs("依民法第四百二十四條")).toEqual([{ ref: "第四百二十四條", articleNo: "424" }]);
    expect(findArticleRefs("第四百六十三條之一")).toEqual([{ ref: "第四百六十三條之一", articleNo: "463-1" }]);
    expect(findArticleRefs("第十條")).toEqual([{ ref: "第十條", articleNo: "10" }]);
    const r = citeCheck(ok({ summary: "依第四百三十條可以催告修繕。" }), SOURCES);
    expect(r.errors[0]).toMatchObject({ type: "unbacked_reference", articleNo: "430" });
    expect(citeCheck(ok({ summary: "依第四百二十四條可以終止。" }), SOURCES).ok).toBe(true);
  });

  it("引用沒通過驗證時，summary 提到該條也算失敗", () => {
    const r = citeCheck(
      ok({ citations: [{ lawName: "民法", articleNo: "424", quote: "編造的句子" }] }),
      SOURCES,
    );
    expect(r.errors.map((e) => e.type)).toEqual(["quote_mismatch", "unbacked_reference"]);
  });

  it("不是條號的「第一次」「第 2 個月」不會誤判", () => {
    expect(findArticleRefs("第一次跟房東說、第 2 個月的租金、第三方")).toEqual([]);
  });

  it("沒有任何條號、也沒有 citations → 通過", () => {
    expect(citeCheck({ summary: "建議先跟房東溝通。", citations: [], actions: ["保留對話紀錄"] }, SOURCES).ok).toBe(true);
  });
});

describe("多個 citations", () => {
  it("部分正確、部分錯誤：valid 只留正確的，invalidIndexes 標出錯誤", () => {
    const r = citeCheck(
      {
        summary: "押金最多兩個月（租賃條例第 7 條）。",
        citations: [
          { lawName: "租賃住宅市場發展及管理條例", articleNo: "7", quote: "押金之金額，不得逾二個月之租金總額" },
          { lawName: "民法", articleNo: "999", quote: "不存在" },
        ],
        actions: [],
      },
      SOURCES,
    );
    expect(r.ok).toBe(false);
    expect(r.valid.map((c) => c.articleNo)).toEqual(["7"]);
    expect(r.invalidIndexes).toEqual([1]);
  });

  it("不同法規同條號：summary 的「第 7 條」只要有任一 citation 對上就算有依據", () => {
    const r = citeCheck(
      {
        summary: "第 7 條規定押金上限。",
        citations: [{ lawName: "租賃住宅市場發展及管理條例", articleNo: "7", quote: "不得逾二個月之租金總額" }],
        actions: [],
      },
      SOURCES,
    );
    expect(r.ok).toBe(true);
  });
});

describe("stripUnverified（重試仍失敗時的降級）", () => {
  it("移除錯誤引用、把對不上的條號改成「相關規定」、加註", () => {
    const answer = {
      ...ok({
        summary: "依民法第 424 條與第 430 條，你可以終止契約。",
        actions: ["依第429條要求修繕", "拍照"],
        citations: [
          { lawName: "民法", articleNo: "424", quote: "仍得終止契約" },
          { lawName: "民法", articleNo: "430", quote: "亂寫" },
        ],
      }),
      confidence: "high" as const,
    };
    const r = citeCheck(answer, SOURCES);
    const out = stripUnverified(answer, r);
    expect(out.citations).toEqual([{ lawName: "民法", articleNo: "424", quote: "仍得終止契約" }]);
    expect(out.summary).toBe("依民法第 424 條與相關規定，你可以終止契約。");
    expect(out.actions).toEqual(["依相關規定要求修繕", "拍照"]);
    expect(out.note).toBe(UNVERIFIED_NOTE);
    expect(out.confidence).toBe("high"); // 其他欄位保留
    // 降級後的結果必須能通過驗證
    expect(citeCheck(out, SOURCES).ok).toBe(true);
  });

  it("驗證通過時不加註", () => {
    const answer = ok();
    expect(stripUnverified(answer, citeCheck(answer, SOURCES)).note).toBeNull();
  });
});

describe("工具函式", () => {
  it("chineseToNumber", () => {
    expect(chineseToNumber("四百二十四")).toBe(424);
    expect(chineseToNumber("十")).toBe(10);
    expect(chineseToNumber("十二")).toBe(12);
    expect(chineseToNumber("一百零五")).toBe(105);
    expect(chineseToNumber("四百五十")).toBe(450);
    expect(chineseToNumber("一千")).toBe(1000);
    expect(chineseToNumber("abc")).toBeNull();
  });

  it("stripSpaces 移除半形、全形空白與換行", () => {
    expect(stripSpaces(" 甲　乙\n丙\t丁 ")).toBe("甲乙丙丁");
  });
});
