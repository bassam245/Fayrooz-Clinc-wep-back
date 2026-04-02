import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import specialtiesRouter from "./specialties";
import doctorsRouter from "./doctors";
import appointmentsRouter from "./appointments";
import scheduleRouter from "./schedule";
import notificationsRouter from "./notifications";
import analyticsRouter from "./analytics";
import auditRouter from "./audit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(specialtiesRouter);
router.use(doctorsRouter);
router.use(appointmentsRouter);
router.use(scheduleRouter);
router.use(notificationsRouter);
router.use(analyticsRouter);
router.use(auditRouter);

export default router;
