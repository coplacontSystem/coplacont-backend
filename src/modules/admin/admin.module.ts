import { Module } from '@nestjs/common';
import { UserModule } from '../users/user.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [UserModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
