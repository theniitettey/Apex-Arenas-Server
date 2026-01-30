import { Router } from 'express';

import authRoutes from '../services/auth/routes';
// import communityRoutes from '../services/community/routes';
// import financeRoutes from '../services/finance/routes';
// import tournamentRoutes from '../services/tournament/routes';

const router: Router = Router();

router.use('/auth', authRoutes);
// router.use('/community', communityRoutes);
// router.use('/finance', financeRoutes);
// router.use('/tournament', tournamentRoutes);

export default router;
