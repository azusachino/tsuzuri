import { describe, expect, test } from "vitest";
import { Chain, UnsupportedError } from "./chain.ts";

describe("a chain", () => {
  const chain = new Chain<string>("greet", [
    { name: "absent", requires: "a thing this machine lacks", available: () => false, impl: "absent" },
    { name: "present", requires: "nothing", available: () => true, impl: "present" },
  ]);

  test("serves the first available provider, or the forced one", () => {
    expect(chain.get()).toBe("present");
    chain.force("absent");
    expect(chain.get()).toBe("absent");
    chain.force();
    expect(chain.get()).toBe("present");
    expect(() => chain.force("unknown")).toThrow("no provider named unknown");
  });

  test("names the capability and what each provider needs when none is available", () => {
    const none = new Chain("greet", [{ name: "absent", requires: "a thing", available: () => false, impl: "" }]);
    expect(() => none.get()).toThrow(UnsupportedError);
    expect(() => none.get()).toThrow("no provider can greet: absent needs a thing");
  });
});
