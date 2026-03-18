const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "autodev-opencode",
      script: "opencode",
      args: "serve --hostname 127.0.0.1 --port 4096",
      cwd: path.join(__dirname, ".."),
    },
    {
      name: "autodev-workers",
      script: "tsx",
      args: "workers/index.ts",
      cwd: __dirname,
    },
    {
      name: "autodev-controller",
      script: "tsx",
      args: "controller.ts",
      cwd: __dirname,
      autorestart: false,
    },
  ],
};
