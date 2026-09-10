import config from "./playwright.config.js";
// Safari's SVG foreignObject painting differs from Chromium; retain pixel coverage.
export default {
  ...config,
  testMatch: "**/mindmap.spec.js",
  use: { ...config.use, browserName: "webkit", channel: undefined },
};
