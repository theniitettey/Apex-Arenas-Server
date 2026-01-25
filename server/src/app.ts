// import express, { Application } from 'express';
// import cookieParser from 'cookie-parser';

// // Gateway imports
// import {
//   corsMiddleware,
//   helmetMiddleware,
//   mongoSanitizeMiddleware,
//   xssSanitizer,
//   additionalSecurityHeaders,
//   requestSizeLimiter
// } from './gateway/middlewares/security.middleware';
// import { globalRateLimiter, dynamicRateLimiter } from './gateway/middlewares/rateLimiter.middleware';
// import { requestLogger } from './gateway/middlewares/requestLogger.middleware';
// import { globalErrorHandler, notFoundHandler } from './gateway/middlewares/errorHandler.middleware';
// import gatewayRoutes from './gateway/routes';

// const app: Application = express();

// // ============================================================================
// // SECURITY MIDDLEWARE (Order matters!)
// // ============================================================================

// // 1. Request logging (first, to capture all requests)
// app.use(requestLogger);

// // 2. Security headers (Helmet)
// app.use(helmetMiddleware);

// // 3. CORS
// app.use(corsMiddleware);

// // 4. Additional security headers
// app.use(additionalSecurityHeaders);

// // 5. Body parsers with size limits
// app.use(express.json(requestSizeLimiter.json));
// app.use(express.urlencoded(requestSizeLimiter.urlencoded));
// app.use(cookieParser());

// // 6. Sanitization - Prevent NoSQL injection & XSS
// app.use(mongoSanitizeMiddleware);
// app.use(xssSanitizer);

// // 7. Global rate limiting
// app.use(globalRateLimiter);

// // 8. Dynamic rate limiting (route-specific)
// app.use(dynamicRateLimiter);

// // ============================================================================
// // ROUTES
// // ============================================================================

// // Gateway handles all routes
// app.use('/', gatewayRoutes);

// // ============================================================================
// // ERROR HANDLING
// // ============================================================================

// // 404 handler
// app.use(notFoundHandler);

// // Global error handler (must be last)
// app.use(globalErrorHandler);

// export default app;
