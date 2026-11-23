export function safeReturnPath(value: unknown) {
  return typeof value === "string" &&
    value.length <= 2048 &&
    /^#\/(?!\/)/.test(value) &&
    !/[\\\u0000-\u0020\u007f]/.test(value) &&
    !/^#\/(?:login|register|reset-password|forgot-password)(?:[/?#]|$)/.test(
      value,
    )
    ? value
    : "#/";
}
