import { describe, it, expect, vi, afterEach } from "vitest";
import { parseArgs, buildFilters, parseDate } from "../src/cli/qimg.js";

describe("parseArgs", () => {
  it("separates positional args from --long and -short flags", () => {
    const { positional, flags } = parseArgs(["tsearch", "sunset", "--collection", "photos", "-n", "5", "--json"]);
    expect(positional).toEqual(["tsearch", "sunset"]);
    expect(flags).toEqual({ collection: "photos", n: "5", json: true });
  });

  it("treats a flag as boolean when followed by another flag or nothing", () => {
    const { flags } = parseArgs(["--force", "--collection", "photos"]);
    expect(flags).toEqual({ force: true, collection: "photos" });
  });

  it("does not consume a following long flag as a short flag's value", () => {
    const { flags } = parseArgs(["-n", "--json"]);
    expect(flags).toEqual({ n: true, json: true });
  });

  it("allows a long flag's value to start with a single dash", () => {
    // Long-flag lookahead only rejects values starting with "--", not "-".
    const { flags } = parseArgs(["--collection", "-weird"]);
    expect(flags).toEqual({ collection: "-weird" });
  });
});

describe("parseDate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined for a missing value", () => {
    expect(parseDate(undefined)).toBeUndefined();
  });

  it("parses a YYYY-MM-DD string to Unix ms at start of day", () => {
    const ms = parseDate("2026-01-15");
    expect(new Date(ms!).toISOString().slice(0, 10)).toBe("2026-01-15");
  });

  it("returns the last millisecond of the day when endOfDay is true", () => {
    const ms = parseDate("2026-01-15", true);
    const d = new Date(ms!);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("exits with an error for an invalid date string", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    parseDate("not-a-date");
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});

describe("buildFilters", () => {
  it("only includes filters that were actually provided", () => {
    expect(buildFilters({ positional: [], flags: {} })).toEqual({});
  });

  it("builds collection/after/before from flags", () => {
    const filters = buildFilters({
      positional: [],
      flags: { collection: "photos", after: "2026-01-01", before: "2026-01-31" },
    });
    expect(filters.collection).toBe("photos");
    expect(new Date(filters.after!).toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(new Date(filters.before!).toISOString().slice(0, 10)).toBe("2026-01-31");
  });
});
