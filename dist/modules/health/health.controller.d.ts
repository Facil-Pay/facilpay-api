import { HealthService } from './health.service';
export declare class HealthController {
    private readonly healthService;
    constructor(healthService: HealthService);
    health(): Promise<{
        status: string;
        timestamp: string;
        services: {
            database: {
                connected: boolean;
                message: string;
            };
        };
    }>;
}
