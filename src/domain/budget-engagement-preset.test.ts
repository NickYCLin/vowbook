import { describe, expect, it } from "vitest";

import {
  BUDGET_ENGAGEMENT_PRESET_GROUPS,
  BUDGET_ENGAGEMENT_SUGGESTION_KEYS,
} from "./budget-engagement-preset";

describe("budget engagement preset", () => {
  it("keeps the Drive groom and bride suggestions under their fixed taxonomy items", () => {
    expect(BUDGET_ENGAGEMENT_PRESET_GROUPS).toMatchObject([
      {
        taxonomyItemKey: "ITEM_ENGAGEMENT_GROOM",
        label: "男方準備",
        items: [
          { name: "大聘" },
          { name: "小聘" },
          { name: "貢禮官" },
          { name: "木盛盒" },
          { name: "六禮／十二禮" },
          { name: "祭祖用品" },
          { name: "媒人禮" },
          { name: "接應禮" },
          { name: "端禮盆禮" },
          { name: "點燭禮" },
          { name: "喝茶禮（壓茶歐）" },
          { name: "禮車" },
          { name: "壓桌禮" },
        ],
      },
      {
        taxonomyItemKey: "ITEM_ENGAGEMENT_BRIDE",
        label: "女方準備",
        items: [
          { name: "接聘禮" },
          { name: "好命婆" },
          { name: "起家禮" },
          { name: "六禮／十二禮" },
          { name: "祭祖用品" },
          { name: "其他" },
        ],
      },
    ]);
  });

  it("exports one unique stable key for every suggestion", () => {
    const exportedKeys = Object.values(BUDGET_ENGAGEMENT_SUGGESTION_KEYS);
    const itemKeys = BUDGET_ENGAGEMENT_PRESET_GROUPS.flatMap((group) =>
      group.items.map((item) => item.key),
    );

    expect(itemKeys).toHaveLength(19);
    expect(new Set(itemKeys).size).toBe(itemKeys.length);
    expect(itemKeys).toEqual(exportedKeys);
    expect(
      itemKeys.every((key) =>
        (key.startsWith("ENGAGEMENT_GROOM_") || key.startsWith("ENGAGEMENT_BRIDE_")) && !/[^A-Z0-9_]/u.test(key),
      ),
    ).toBe(true);
  });

  it("preserves Drive details in notes without importing example amounts", () => {
    const byKey = new Map(
      BUDGET_ENGAGEMENT_PRESET_GROUPS.flatMap((group) =>
        group.items.map((item) => [item.key, item]),
      ),
    );

    expect(
      byKey.get(BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_SIX_OR_TWELVE_GIFTS)
        ?.notes,
    ).toBe(
      "盒餅（小餅）：西式喜餅；日頭餅（大餅）：中式漢餅；四金：贈與新娘耳環、項鍊、手鐲、金戒指；四色：金、香、炮、燭；六甜：冬瓜糖、戒指餅、桔餅、桂圓、冰糖、囍糖；女方頭尾禮（6／12件）；酒、麵線、糯米／砂糖、豬肉／火腿、醃雞／帶路雞、囍花／罐頭。",
    );
    expect(
      byKey.get(BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_SIX_OR_TWELVE_GIFTS)
        ?.notes,
    ).toBe(
      "二金四金：贈與新郎項鍊、金戒指；男方頭尾禮（6／12件）；木炭、麥／穀、黑砂糖、緣錢、肚圍、芋葉。",
    );
    expect(
      byKey.get(BUDGET_ENGAGEMENT_SUGGESTION_KEYS.GROOM_TABLE_GIFT)?.notes,
    ).toBe("桌數／桌價依實際填寫。");
    expect(
      byKey.get(BUDGET_ENGAGEMENT_SUGGESTION_KEYS.BRIDE_OTHER)?.notes,
    ).toBe("甜茶、茶盤、杯子、甜湯圓、高腳椅、矮凳、雞腿。");
    expect(JSON.stringify(BUDGET_ENGAGEMENT_PRESET_GROUPS)).not.toMatch(
      /(?:amount|price|金額)/iu,
    );
  });
});
