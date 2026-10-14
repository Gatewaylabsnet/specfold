import { describe, expect, it } from "vitest";
import { compareReleaseVersions, parseReleaseVersion } from "./releaseVersions";

describe("release version precedence", () => {
  it.each([
    ["1.11.0", "1.11.0-dev.1"], ["1.11.0", "1.11.0-rc.10"], ["1.11.0", "1.10.99"],
    ["1.11.1-dev.1", "1.11.0"], ["2.0.0", "1.999.999"], ["1.11.0-dev.10", "1.11.0-dev.2"],
    ["1.11.0-alpha.1", "1.11.0-alpha"], ["1.11.0-alpha.beta", "1.11.0-alpha.1"],
    ["1.11.0-beta", "1.11.0-alpha.beta"], ["1.11.0-beta.2", "1.11.0-beta"],
    ["1.11.0-beta.11", "1.11.0-beta.2"], ["1.11.0-rc.1", "1.11.0-beta.11"],
    ["1.11.0-dev.999999999999999999999999999999", "1.11.0-dev.999999999999999999999999999998"],
    ["99999999999999999999.0.0", "99999999999999999998.0.0"]
  ])("treats %s as newer than %s and refuses the reverse downgrade", (newer, older) => {
    expect(compareReleaseVersions(newer, older)).toBe(1);
    expect(compareReleaseVersions(older, newer)).toBe(-1);
  });
  it.each([
    ["1.11.0", "1.11.0"], ["v1.11.0", "1.11.0"], [" V1.11.0 ", "1.11.0"],
    ["1.11.0+build.1", "1.11.0+build.99"], ["1.11.0-dev.1+build.1", "1.11.0-dev.1+other"],
    ["1.11.0+001", "1.11.0"]
  ])("ignores tag prefix/metadata precedence for %s and %s", (left, right) => {
    expect(compareReleaseVersions(left, right)).toBe(0);
  });
  it.each(["", "v", "1", "1.11", "1.11.0.1", "01.11.0", "1.01.0", "1.11.00", "-1.11.0",
    "1.11.0-dev.01", "1.11.0-", "1.11.0-dev..1", "1.11.0+", "1.11.0+build..1",
    "1.11.0-beta/1", "1.11.0\nSYNTHETIC_INVALID", "vv1.11.0", "x".repeat(257)])("rejects malformed version %s", (invalid) => {
    expect(parseReleaseVersion(invalid)).toBeUndefined();
    expect(compareReleaseVersions(invalid, "1.11.0")).toBeUndefined();
    expect(compareReleaseVersions("1.11.0", invalid)).toBeUndefined();
  });
  it("allows nonnumeric prerelease identifiers with leading zero and normalizes a valid tag", () => {
    expect(parseReleaseVersion("v1.11.0-01a+build.001")).toEqual({ value: "1.11.0-01a+build.001", core: ["1", "11", "0"], prerelease: ["01a"] });
    expect(parseReleaseVersion(undefined)).toBeUndefined();
    expect(parseReleaseVersion({ version: "1.11.0" })).toBeUndefined();
  });
});
