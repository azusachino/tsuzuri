import {
  CaptureError,
  ConfigError,
  InputError,
  LineRangeError,
  NotFoundError,
  PermissionError,
  SectionError,
  TsuzuriError,
  UnsupportedError,
  WriteConflictError,
} from "tsuzuri";
import { expect, test } from "vitest";

test("every error tsuzuri raises is a TsuzuriError named after its class", () => {
  const classes = [
    CaptureError,
    ConfigError,
    InputError,
    LineRangeError,
    NotFoundError,
    PermissionError,
    SectionError,
    UnsupportedError,
    WriteConflictError,
  ];
  for (const ErrorClass of classes) {
    const error = new ErrorClass("x");
    expect(error).toBeInstanceOf(TsuzuriError);
    expect(error.name).toBe(ErrorClass.name);
  }
});
