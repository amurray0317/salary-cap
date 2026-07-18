import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("serializes headers and rows", () => {
    const csv = toCsv(["a", "b"], [["1", 2], ["3", null]]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,\r\n");
  });

  it("quotes fields containing commas, quotes, and newlines (RFC 4180)", () => {
    const csv = toCsv(["name"], [['He said "hi", twice\nnew line']]);
    expect(csv).toBe('name\r\n"He said ""hi"", twice\nnew line"\r\n');
  });
});
