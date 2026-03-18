module.exports = {
  apps: [
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
