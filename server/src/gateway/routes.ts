// import { Router } from 'express';

// // Import service routes (will be created later)
// // import authRoutes from '../services/auth/routes';
// // import tournamentRoutes from '../services/tournament/routes';
// // import financeRoutes from '../services/finance/routes';
// // import communityRoutes from '../services/community/routes';

// const router = Router();

// // API Version prefix
// const API_VERSION = '/api/v1';

// /**
//  * Health check endpoint - no auth required
//  */
// router.get('/health', (req, res) => {
//   res.status(200).json({
//     success: true,
//     message: 'Apex Arenas API is running',
//     timestamp: new Date().toISOString(),
//     version: process.env.API_VERSION || '1.0.0'
//   });
// });

// /**
//  * Service Route Registration
//  * Each service handles its own sub-routes
//  */

// // Auth & Identity Service
// // router.use(`${API_VERSION}/auth`, authRoutes);

// // Tournament & Competition Service
// // router.use(`${API_VERSION}/tournaments`, tournamentRoutes);
// // router.use(`${API_VERSION}/games`, gameRoutes);
// // router.use(`${API_VERSION}/teams`, teamRoutes);
// // router.use(`${API_VERSION}/matches`, matchRoutes);

// // Finance & Escrow Service
// // router.use(`${API_VERSION}/finance`, financeRoutes);
// // router.use(`${API_VERSION}/transactions`, transactionRoutes);
// // router.use(`${API_VERSION}/payouts`, payoutRoutes);

// // Community & Notifications Service
// // router.use(`${API_VERSION}/community`, communityRoutes);
// // router.use(`${API_VERSION}/notifications`, notificationRoutes);

// /**
//  * 404 Handler - Must be last
//  */
// router.use('*', (req, res) => {
//   res.status(404).json({
//     success: false,
//     error: {
//       code: 'ROUTE_NOT_FOUND',
//       message: `Route ${req.method} ${req.originalUrl} not found`
//     }
//   });
// });

// export default router;
