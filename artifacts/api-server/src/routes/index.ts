import { Router, type IRouter } from "express";
import healthRouter from "./health";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicRouter);

export default router;
