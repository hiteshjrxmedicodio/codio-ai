import "dotenv/config";
import { createApp } from "./app";
import { getConfig } from "./core/config";

const { host, port } = getConfig().server;

createApp().listen(port, host, () => {
  console.log(`CDI Assist service on http://${host}:${port}`);
});
