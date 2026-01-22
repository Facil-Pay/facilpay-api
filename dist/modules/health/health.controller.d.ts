import { HealthService } from './health.service';
export declare class HealthController {
    private readonly healthService;
    constructor(healthService: HealthService);
    health(): {
        status: string;
    };
    root(): {
        message: string;
    };
}
