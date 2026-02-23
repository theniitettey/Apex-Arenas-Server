import express, {Express} from 'express';
import cors from 'cors';
import { corsManager } from './configs/cors.config';
import gatewayRoutes from './gateway/routes';

const app: Express = express();

app.use(cors(corsManager.getCorsConfig()));

app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/api/v1', gatewayRoutes);

export default app;
