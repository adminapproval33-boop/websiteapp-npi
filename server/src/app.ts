import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { authRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";
import { masterDataRouter } from "./modules/masterdata/masterdata.routes";
import { filesRouter } from "./modules/files/files.routes";
import { premixAftermixRouter } from "./modules/premixAftermix/premixAftermix.routes";
import { millingRouter } from "./modules/milling/milling.routes";
import { colourMatchingRouter } from "./modules/colourMatching/colourMatching.routes";
import { bongkaranRouter } from "./modules/bongkaran/bongkaran.routes";
import { packingRouter } from "./modules/packing/packing.routes";
import { productSpecRouter } from "./modules/productSpec/productSpec.routes";
import { checkResultsRouter } from "./modules/checkResults/checkResults.routes";
import { approvalRouter } from "./modules/approval/approval.routes";
import { adminQcRouter } from "./modules/adminQc/adminQc.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { tankManualInputRouter } from "./modules/tankManualInput/tankManualInput.routes";
import { productionOrderManualInputRouter } from "./modules/productionOrderManualInput/productionOrderManualInput.routes";
import { productionLabelRouter } from "./modules/productionLabel/productionLabel.routes";
import { maintenanceRouter } from "./modules/maintenance/maintenance.routes";
import { postsRouter } from "./modules/posts/posts.routes";
import { chatRouter } from "./modules/chat/chat.routes";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ success: true, status: "ok", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/master-data", masterDataRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/premix-aftermix", premixAftermixRouter);
  app.use("/api/milling", millingRouter);
  app.use("/api/colour-matching", colourMatchingRouter);
  app.use("/api/bongkaran", bongkaranRouter);
  app.use("/api/packing", packingRouter);
  app.use("/api/product-specs", productSpecRouter);
  app.use("/api/check-results", checkResultsRouter);
  app.use("/api/approvals", approvalRouter);
  app.use("/api/admin-qc", adminQcRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/tank-manual-input", tankManualInputRouter);
  app.use("/api/production-order-manual-input", productionOrderManualInputRouter);
  app.use("/api/production-label", productionLabelRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/chat", chatRouter);

  app.use(errorHandler);

  return app;
}
