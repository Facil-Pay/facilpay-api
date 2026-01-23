import { AppService } from './app.service';
import { User } from './modules/users/user.entity';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHello(): string;
    getProfile(user: User): {
        message: string;
        user: User;
    };
}
