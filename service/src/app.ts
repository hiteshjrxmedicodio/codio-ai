import express from "express";
import { getConfig } from "./core/config";
import { localCors } from "./core/http";
import { agentRoutes } from "./modules/agent/agent.routes";
import { cdiRoutes } from "./modules/cdi/cdi.routes";
import { dictationRoutes } from "./modules/dictation/dictation.routes";
import { feedbackRoutes } from "./modules/feedback/feedback.routes";
import { filesRoutes } from "./modules/files/files.routes";
import { pageRoutes } from "./modules/page/page.routes";
import { reportRoutes } from "./modules/report/report.routes";
import { selectionRoutes } from "./modules/selection/selection.routes";
import { icdRoutes } from "./modules/icd/icd.routes";
import { voiceRoutes } from "./modules/voice/voice.routes";

export function createApp() {
  const app = express();
  app.use(localCors);
  app.use(express.json({ limit: getConfig().server.json_limit }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/v1/page", pageRoutes);
  app.use("/v1/agent", agentRoutes);
  app.use("/v1/cdi", cdiRoutes);
  app.use("/v1/voice", voiceRoutes);
  app.use("/v1/dictation", dictationRoutes);
  app.use("/v1/files", filesRoutes);
  app.use("/v1/report", reportRoutes);
  app.use("/v1/select", selectionRoutes);
  app.use("/v1/icd", icdRoutes);
  app.use("/v1/feedback", feedbackRoutes);
  return app;
}
