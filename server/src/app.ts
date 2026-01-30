import express from 'express';
import gatewayRoutes from './gateway/routes';

const app: express.Application = express();

app.use(express.json());
app.use('/v1/api', gatewayRoutes);

export default app;
