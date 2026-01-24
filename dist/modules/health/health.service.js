"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
let HealthService = class HealthService {
    dataSource;
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async check() {
        const dbStatus = await this.checkDatabase();
        return {
            status: dbStatus.connected ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            services: {
                database: dbStatus,
            },
        };
    }
    async checkDatabase() {
        try {
            if (this.dataSource.isInitialized) {
                await this.dataSource.query('SELECT 1');
                return { connected: true, message: 'Database connection is healthy' };
            }
            return { connected: false, message: 'Database not initialized' };
        }
        catch (error) {
            return {
                connected: false,
                message: error instanceof Error ? error.message : 'Unknown database error',
            };
        }
    }
};
exports.HealthService = HealthService;
exports.HealthService = HealthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], HealthService);
//# sourceMappingURL=health.service.js.map