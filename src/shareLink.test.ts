import { describe, expect, it } from "vitest";
import {
  decodeBuild,
  encodeBuild,
  payloadFromHash,
  ShareLinkError,
} from "./shareLink";
import { STARTER_TEMPLATES } from "./templates";

describe("share links", () => {
  it.each(STARTER_TEMPLATES.map((t) => [t.label, t] as const))(
    "round-trips %s",
    async (_label, template) => {
      const { base, components } = template.build();
      const payload = await encodeBuild(base, components);
      const decoded = await decodeBuild(payload);
      expect(decoded).not.toBeNull();
      expect(decoded!.base).toEqual(JSON.parse(JSON.stringify(base)));
      expect(decoded!.components).toEqual(
        JSON.parse(JSON.stringify(components)),
      );
    },
  );

  it("keeps every starter template within the link size limit", async () => {
    const sizes = await Promise.all(
      STARTER_TEMPLATES.map(async (t) => {
        const { base, components } = t.build();
        return (await encodeBuild(base, components)).length;
      }),
    );
    expect(Math.max(...sizes)).toBeLessThanOrEqual(8000);
  });

  it("rejects garbage, truncation and unknown versions", async () => {
    const { base, components } = STARTER_TEMPLATES[0].build();
    const good = await encodeBuild(base, components);
    expect(await decodeBuild("")).toBeNull();
    expect(await decodeBuild("not a build")).toBeNull();
    expect(await decodeBuild("v9.AAAA")).toBeNull();
    expect(
      await decodeBuild(good.slice(0, Math.floor(good.length / 2))),
    ).toBeNull();
  });

  it("rejects a well-formed payload that is not a build", async () => {
    const json = new TextEncoder().encode(
      JSON.stringify({ base: { floors: [] }, components: [] }),
    );
    const payload =
      "v0." + btoa(String.fromCharCode(...json)).replace(/=+$/, "");
    expect(await decodeBuild(payload)).toBeNull();
  });

  it("refuses builds with an imported model instead of making a huge link", async () => {
    const { base, components } = STARTER_TEMPLATES[0].build();
    const withModel = [
      ...components,
      {
        ...components[0],
        id: "m1",
        type: "model",
        modelData: "data:model/gltf+json;base64,AAAA",
      },
    ];
    await expect(
      encodeBuild(base, withModel as typeof components),
    ).rejects.toBeInstanceOf(ShareLinkError);
  });

  it("finds the payload in a location hash", () => {
    expect(payloadFromHash("#build=v1.abc")).toBe("v1.abc");
    expect(payloadFromHash("build=v1.abc")).toBe("v1.abc");
    expect(payloadFromHash("#other=1")).toBeNull();
    expect(payloadFromHash("")).toBeNull();
  });
});
